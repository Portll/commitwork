// admin/lib/jobs.mjs — the panel's job engine: trigger a run, tail it, stop it.
//
// EXTRACTED VERBATIM FROM admin/serve.mjs 2026-09-04. The bodies below are unchanged; what moved
// is where they live. Three things made this worth doing beyond line count: the engine is the
// piece admin/routes/tools.mjs already reaches through ctx.trigger, it is the piece most likely to
// grow new job kinds, and it was 318 lines of a 3,600-line file that no test could reach without
// booting a server on two ports with an auth store behind it.
//
// DEPENDENCIES ARE INJECTED, NOT IMPORTED. serve.mjs owns the registry accessor, the project
// allowlist and the session-store path; importing them here would either duplicate that ownership
// or create a cycle (serve.mjs -> jobs.mjs -> serve.mjs). initJobs() is called once at boot,
// before any request can arrive, and the identifiers below are deliberately the SAME names the
// block already used — so the moved code needed no edits at its 19 reference sites.
//
// initJobs() also builds `jobs`, which used to be built at module load. loadPersistedJobs() reads
// healthRunsPath(), which reads an injected dep — so at import time it would have read undefined
// and restored nothing, silently losing every persisted health run.

import { spawn } from 'node:child_process';
import { quotedArgv } from '../../lib/posix-shell.mjs';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, chmodSync, renameSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
// Imported directly, not injected: both are leaf modules under monitor/ with no path back to
// serve.mjs, so there is no cycle to avoid and injecting them would only hide where they come from.
import { parseLaneProgress } from '../../monitor/lane-progress.mjs'; // the runner's per-lane grammar, parsed by the module that writes it
import { resolveRepos } from '../../monitor/discover.mjs';
import { killOwned, procIo } from '../../monitor/containers.mjs';
import { scanOutDir as scanOutDirFor } from '../../bin/lib/scan-target.mjs';

// Set by initJobs(). Same names as serve.mjs used, so the extracted block is untouched.
let CW, registry, sessionStorePath, projectSlug, primaryArea;

export function initJobs(deps) {
  ({ CW, registry, sessionStorePath, projectSlug, primaryArea } = deps);
  // Restore persisted health runs now that healthRunsPath() can resolve. Object.assign rather than
  // reassignment: consumers hold the exported binding and index it directly.
  Object.assign(jobs, loadPersistedJobs());
  return { jobs, running };
}

// SSE slot accounting. `sseClients` is a counter the /api/status/events route MUTATES, and an ES
// module export is a read-only binding at the importer — so the counter stays here and the route
// moves it through these. Same arithmetic as before, one owner instead of two.
export const sseSlots = {
  get cap() { return SSE_CAP; },
  get count() { return sseClients; },
  full: () => sseClients >= SSE_CAP,
  acquire: () => { sseClients++; },
  release: () => { sseClients--; },
};

// Live job tracking — a triggered sweep's stdout/stderr is captured into an in-memory ring
// buffer (the panel tails it) and parsed into structured progress, instead of the old fire-and-
// forget `stdio:'ignore'`. The panel polls /api/status while a job runs and refreshes the
// numbers the instant it finishes. `running` (bare booleans) is kept for back-compat.
export const LOG_CAP = 400;                                   // lines retained for the live tail
export const running = {};

// The post-mortem log, one per job kind (gitignored: *.log + /reports/). All kinds shared
// sweep-latest.log once, and every start truncated it, so a health run launched mid-sweep erased
// the sweep's log and interleaved into what followed. The sweep keeps its path and its override.
// Resolved at trigger time, never at load: `CW` is injected, and env overrides are read per call.
export function jobLogPath(kind) {
  if (kind === 'sweep' && process.env.CW_SWEEP_LIVE_LOG) return process.env.CW_SWEEP_LIVE_LOG;
  if (process.env.CW_JOB_LOG_DIR) return join(process.env.CW_JOB_LOG_DIR, `${kind}-latest.log`);
  // A scan's log names the repositories it read, so it goes where its report goes.
  if (kind === 'scan-path') return join(scanOutDir().dir, `${kind}-latest.log`);
  return join(CW, 'reports', `${kind}-latest.log`);
}

// Where scan-path output goes (bin/lib/scan-target.mjs), for the checkout initJobs() was given.
export function scanOutDir() {
  return scanOutDirFor({ checkout: CW });
}

// Health runs survive a panel restart. The file follows the auth/session fixture automatically,
// so a test that redirects CW_AUTH_STORE cannot leak records into the operator's real home.
const healthRunsPath = () => process.env.CW_HEALTH_RUNS_STORE
  || sessionStorePath().replace(/sessions\.json$/i, 'health-runs.json');
const HEALTH_JOB_KINDS = new Set(['health-all', 'health-deadcode', 'health-toolchain', 'health-provenance', 'health-gates']);

function loadPersistedJobs() {
  const restored = {};
  let doc;
  try { doc = JSON.parse(readFileSync(healthRunsPath(), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return restored; return restored; }
  if (!doc || doc.version !== 1 || !doc.jobs || typeof doc.jobs !== 'object' || Array.isArray(doc.jobs)) return restored;
  const interruptedAt = new Date().toISOString();
  for (const [kind, raw] of Object.entries(doc.jobs)) {
    if (!HEALTH_JOB_KINDS.has(kind) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const j = { ...raw, kind, proc: null, lines: Array.isArray(raw.lines) ? raw.lines.slice(-LOG_CAP) : [] };
    if (j.running) { j.running = false; j.interruptedAt = interruptedAt; j.phase = 'interrupted'; }
    restored[kind] = j;
  }
  return restored;
}

function persistJobs() {
  const path = healthRunsPath();
  const serialised = {};
  for (const [kind, j] of Object.entries(jobs)) {
    if (!HEALTH_JOB_KINDS.has(kind)) continue;
    const { proc: _proc, logPath: _logPath, ...safe } = j;
    serialised[kind] = { ...safe, lines: (safe.lines || []).slice(-LOG_CAP) };
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, jobs: serialised }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
    return true;
  } catch (e) {
    console.error(`[health-runs] ${e.message}`);
    return false;
  }
}

export const jobs = {}; // filled by initJobs() — NOT at module load: healthRunsPath() needs deps // kind -> { running, startedAt, finishedAt, exitCode, phase, done, total, current, batchDir, seq, lines[] }

// parse one output line into the job's progress model. The markers are emitted by
// monitor/sweep.mjs (and its grandchild tool output flows through the same pipe → real live tail).
// Live subscribers (SSE). `seq` was always the right cursor — it just had no route that honoured
// it as one, so the panel re-rendered all 400 retained lines every 1200ms. Subscribers get each
// line once, tagged with its seq, and a reconnecting client replays the gap from Last-Event-ID.
export const jobSubs = new Set(); // fn(kind, {seq, line}) | fn(kind, {status})
export const SSE_CAP = Math.max(1, Number(process.env.CW_SSE_CAP || 8));
let sseClients = 0;

function publish(kind, payload) {
  for (const fn of jobSubs) { try { fn(kind, payload); } catch { /* a broken subscriber is not the job's failure */ } }
}

// ── PER-LANE RUN STATE ──────────────────────────────────────────────────────────────────────────
// A sweep is a nest of loops — areas, then repos, then lanes — and until now only the middle one
// was observable. `job.lanes` is the innermost, keyed by check id because that is what a panel tab
// IS; the repos a lane is currently running against travel inside it, so a fleet sweep reports
// "sast: running on 3, finished 47" rather than collapsing to a single boolean.
//
// Bounded by construction: the key space is the declared check set (~62), and the only growing
// field is a Set of in-flight repo names which a matching `end` removes. There is no per-completion
// array here — 100 repos x 60 lanes is 6,000 events, and retaining them would make the status
// payload grow without limit over a long sweep.
const laneRec = () => ({ running: [], done: 0, ok: 0, failed: 0, void: 0, skipped: 0,
  // Declared in the shape rather than sprouted on the first abandonment, so a consumer can tell
  // "no lane was abandoned" from "this build predates the field" — the same reason coverage is
  // written even when full.
  abandoned: 0, abandonedRepos: [],
  lastStatus: null, lastMs: null, lastRepo: null, lastAt: null, firstStartedAt: null });

function recordLane(job, lane) {
  job.lanes ||= {};
  const r = (job.lanes[lane.check] ||= laneRec());
  const at = new Date().toISOString();
  if (lane.event === 'start') {
    r.firstStartedAt ||= at;
    if (lane.repo && !r.running.includes(lane.repo)) r.running.push(lane.repo);
  } else {
    if (lane.repo) r.running = r.running.filter((x) => x !== lane.repo);
    r.done++;
    // The four outcomes are counted APART. A lane that ran 100 times and was skipped 100 times has
    // done=100 either way, and "it ran" is the reading a single counter invites — the same
    // absence-as-result swap the coverage fields exist to prevent.
    if (lane.status === 'pass') r.ok++;
    else if (lane.status === 'fail') r.failed++;
    else if (lane.status === 'noscan') r.void++;
    else if (lane.status === 'skipped' || lane.status === 'skip') r.skipped++;
    r.lastStatus = lane.status; r.lastMs = lane.ms; r.lastRepo = lane.repo; r.lastAt = at;
  }
  // A dedicated frame rather than a full status republish: a completion is one lane's news, and
  // pushing the whole job status 6,000 times a sweep would spend the stream on unchanged fields.
  publish(job.kind, { lane: { check: lane.check, event: lane.event, repo: lane.repo,
    status: lane.status ?? null, ms: lane.ms ?? null, at, project: job.project || null, rec: r } });
}

function feed(job, line) {
  job.seq++;
  job.lines.push(line);
  if (job.lines.length > LOG_CAP) job.lines.splice(0, job.lines.length - LOG_CAP);
  publish(job.kind, { seq: job.seq, line });
  if (job.logPath) try { appendFileSync(job.logPath, line + '\n'); } catch { /* best-effort */ }
  // Bounded before any marker regex runs: `line` is a scanned repo's tool output, untrusted per
  // house rule, and can be arbitrarily long — the ->/status patterns below are superlinear on
  // pathological input. Every real marker sweep.mjs emits is a short console.log line, so 2000
  // chars is generous headroom, not a truncation that could miss one.
  const scan = line.length > 2000 ? line.slice(0, 2000) : line;
  // Per-lane state, from the grammar monitor/lane-progress.mjs writes. Parsed FIRST and returned:
  // a lane line is never also a sweep marker, and running it past the patterns below would only
  // give a check id named after one of them a chance to move the repo counter.
  const lane = parseLaneProgress(scan);
  if (lane) { recordLane(job, lane); return; }
  let m;
  if ((m = scan.match(/\[sweep\]\s+(\d+)\s+repos/))) { job.total = +m[1]; job.phase = 'scanning'; }
  if ((m = scan.match(/->\s*(\S*sweep-\d+)/))) job.batchDir = m[1];
  if ((m = scan.match(/\((\d+)\/(\d+)\)\s+scan\s+(.+?)\s*$/))) { job.done = +m[1]; job.total = +m[2]; job.current = m[3]; job.phase = 'scanning'; }
  else if (/\[sweep\]\s+rollup\b/.test(scan)) { job.phase = 'rollup'; job.current = null; }
  else if (/\[sweep\]\s+timeline\b/.test(scan)) { job.phase = 'timeline'; }
  else if (/\[sweep\]\s+runtime\b/.test(scan)) { job.phase = 'runtime'; }
  else if (/\[sweep\]\s+done\b/.test(scan)) { job.phase = 'done'; }
}

// Resolve the project a trigger should act on: the panel's ACTIVE project (the picker's
// selection, posted by the client), else the registry's primary area. Never the old hardcoded
// 'clientA'. The requested value is validated against the REAL sweepable set — declared areas,
// registry entries, AND root-discovered repos — so a picker selection like `client-d` (discovered,
// absent from projects[]) sweeps client-d rather than silently falling back to the fleet. Anything
// unrecognised falls back to primary, so no arbitrary string ever reaches argv.
let _known = null, _knownAt = 0;
export function knownProjects() {
  if (_known && Date.now() - _knownAt < 30_000) return _known;
  const set = new Set([
    ...(registry().areas || []).map((a) => a.slug),
    ...(registry().projects || []).map((p) => p.name),
  ]);
  // discovered repos: a filesystem walk, so cache briefly — triggers are manual button presses.
  try { for (const r of resolveRepos(registry(), { selfRoot: CW }).repos) set.add(r.name); } catch { /* registry-only fallback */ }
  _known = set; _knownAt = Date.now();
  return set;
}
export function triggerProject(requested) {
  const raw = String(requested || '');
  const slug = projectSlug(raw) || raw;                       // label ('Client A') → slug ('client-a')
  // Return the known set's OWN copy of the matched name, never the caller's string. The values are
  // equal, but the returned one originated in the registry / filesystem discovery, so what reaches
  // spawn argv is a declared name — the request only ever selects, it never supplies bytes.
  for (const cand of [slug, raw]) {
    if (!cand) continue;
    for (const known of knownProjects()) if (known === cand) return known;
  }
  return primaryArea(registry())?.slug || '';
}

// opts.check  — a single manifest check id, ALREADY resolved from the closed SCANNER_CHECKS map by
//               the caller. Never a caller-supplied string (see the /api/scan handler).
// opts.repo   — narrow to one repo; sweep.mjs refuses it if it is outside the scoped area.
// opts.label  — what to call this run in the panel's console.
//
// A targeted scan runs under the SAME job kind as a full sweep, deliberately. Both write into the
// same area's batch and report tree, so a second kind would only buy the ability to race a sweep
// against itself; one slot means "already running" instead of two processes interleaving writes.
//
// Exit codes that are a completed run REPORTING something, not a run that broke: stpa-sweep exits
// 21 on a flagged row, 23 on an open finding with nothing flagged, and 24 on an unclassified closure
// point (its header is the contract). Any other non-zero exit, Node's 1 for a module that failed to
// load included, is a sweep that did not complete. Without this, every stpa run with a finding open
// or a point unchecked would finish with phase 'starting'.
const REPORTING_EXITS = { stpa: [21, 23, 24] };
const HEALTH = { 'health-deadcode': 'deadcode', 'health-toolchain': 'toolchain', 'health-provenance': 'provenance', 'health-gates': 'gates', 'health-all': 'all' };

// The argv a job kind spawns, or null for an unknown kind. Exported so a test can hold each flag
// against the CLI that has to parse it.
export function jobArgv(kind, proj, opts = {}) {
  // CW_SWEEP_CMD overrides the default job command (ops: pick a group; tests: a fake emitter).
  // Split into argv by quotedArgv(), NOT on a bare space. The comment here used to read "the
  // default paths contain no spaces", which is false on Windows: the default node lives under
  // `C:\Program Files\`, so a bare split produced ['C:\Program', ...] and the job
  // never started. Nothing sees a shell on this path, so double quotes are the only way to spell a
  // path with a space. It still wins over opts.check: it is the declared override seam, and a
  // caller who has pinned the command means it. The selection reaches it through sweepOverride().
  return kind === 'sweep'
    ? (process.env.CW_SWEEP_CMD ? quotedArgv(process.env.CW_SWEEP_CMD)
      : ['node', join(CW, 'monitor/sweep.mjs'), opts.check || 'all', proj,
        ...(opts.repo ? ['--repo', opts.repo] : [])].filter(Boolean))
    : kind === 'bola'
      // bola-sweep is argv-spawned with the resolved area SLUG (never a caller string): it re-derives
      // manifest+base from projects.json and refuses unless the area's secrets are configured, so the
      // panel button can only ever run a declared, ready area against its declared testbed base.
      ? ['node', join(CW, 'monitor/bola-sweep.mjs'), proj].filter(Boolean)
    : kind === 'stpa'
      // stpa-sweep re-derives commitwork's own admin-panel/remediation control loop from CURRENT
      // source and classifies it against a fixed UCA/HAZOP table — a sensor, never an actuator; it
      // takes no argv beyond the resolved project, same closed-selector discipline as bola above.
      ? ['node', join(CW, 'monitor/stpa-sweep.mjs'), proj].filter(Boolean)
    : kind === 'install-tools'
      // Reuses `commitwork setup` exactly as a terminal user would run it — no separate install
      // logic here. opts.only (if given) is a plain string array in argv, never shell-joined;
      // an unrecognised name just matches nothing in toolPlan()'s own filter.
      ? ['node', join(CW, 'bin/commitwork.mjs'), 'setup', '--yes',
        ...(opts.only?.length ? ['--only', opts.only.join(',')] : [])]
    : kind === 'scan-path'
      // `commitwork brief` scans, then writes brief.{json,md,html} beside the reports. It installs
      // nothing, so missing scanners are the install-tools job's to add. opts.path reaches argv as one
      // element, never a shell string. No opts.out, no argv: the output must be private.
      ? (opts.out && (opts.pc || opts.path)
        ? ['node', join(CW, 'bin/commitwork.mjs'), 'brief', ...(opts.pc ? ['--pc'] : ['--root', opts.path]), '--out', opts.out]
        : null)
    : HEALTH[kind]
      ? ['node', join(CW, 'monitor/health-sweep.mjs'), HEALTH[kind], proj].filter(Boolean)
      : null;
}

// Under CW_SWEEP_CMD the picker's selection stays out of argv: appending it would hand a fake
// emitter or an ops group command arguments it never asked for. It travels in env instead, and the
// feed says so, because the job is still labelled with a project the command may ignore. Every key
// is set, empty when unselected, so a value inherited from the panel's env cannot pose as this run's.
export function sweepOverride(proj, opts = {}) {
  if (!process.env.CW_SWEEP_CMD) return null;
  const env = { CW_SWEEP_PROJECT: proj || '', CW_SWEEP_CHECK: opts.check || 'all', CW_SWEEP_REPO: opts.repo || '' };
  const given = Object.entries(env).map(([k, v]) => `${k}=${v || '(none)'}`).join(' ');
  return { env, notice: `[serve] CW_SWEEP_CMD override in effect: the command runs as configured, without the picker's selection in its argv; it receives ${given} in its environment` };
}

// Runs whose subject is commitwork or this machine, not an area, whatever project argv carries:
// STPA reads commitwork's own control loop, and its page is fleet-scoped (VIEW_SCOPE in
// admin/menus/navigation.js); install-tools sets up this machine.
const FLEET_KINDS = new Set(['stpa', 'install-tools']);

export function trigger(kind, project, opts = {}) {
  if (jobs[kind] && jobs[kind].running) return { started: false, reason: 'already running' };
  // A sweep or healthcheck with no project used to fall through triggerProject to the primary area,
  // so "run healthcheck" pressed on the All-projects page ran commitwork alone under a fleet label.
  if ((kind === 'sweep' || HEALTH[kind]) && !String(project || '').trim()) {
    return { started: false, reason: 'no project selected — choose a project first; these runs are per project' };
  }
  // A scanned path belongs to no area; resolving one would label the run with the primary area.
  const proj = kind === 'scan-path' ? '' : triggerProject(project);
  if (kind === 'scan-path') {
    const out = scanOutDir();
    if (!out.ok) return { started: false, refused: true, reason: out.error };
    opts = { ...opts, out: join(out.dir, new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)) };
  }
  const args = jobArgv(kind, proj, opts);
  if (!args) return { started: false, reason: 'unknown job' };
  const override = kind === 'sweep' ? sweepOverride(proj, opts) : null;
  const job = { kind, running: true, startedAt: new Date().toISOString(), finishedAt: null, exitCode: null,
    phase: 'starting', done: 0, total: null, current: null, batchDir: null, seq: 0, lines: [],
    label: opts.label || null,
    // The resolved area, carried so a lane completion can say WHICH subject it belongs to. The
    // panel shows one project at a time and must not attribute another area's finished lane to it.
    project: proj || null,
    // Who may see it (jobVisible): a run nobody scoped is a fleet run, even where triggerProject
    // fell back to the primary area for its argv. A narrowed run also answers to its repo.
    fleet: FLEET_KINDS.has(kind) || (kind !== 'scan-path' && !String(project || '').trim()), repo: opts.repo || null,
    // A scan's path (home, for the whole PC) and output directory, kept to redact them off the operator port.
    secrets: kind === 'scan-path' ? [opts.out, opts.pc ? homedir() : opts.path].filter(Boolean) : [],
    lanes: {}, logPath: jobLogPath(kind) };
  jobs[kind] = job; running[kind] = true;
  if (HEALTH_JOB_KINDS.has(kind)) persistJobs();
  publish(kind, { status: jobStatus(kind) });
  try { mkdirSync(dirname(job.logPath), { recursive: true }); writeFileSync(job.logPath, ''); } catch { /* best-effort */ }
  feed(job, `[serve] starting: ${args.join(' ')}`);
  if (override) feed(job, override.notice);
  // FORCE_COLOR: the child's stdout is a pipe, so bin/lib/theme.mjs would disable colour and the
  // panel's live console would show a themed run in flat grey while the same run in a terminal was
  // legible. Opting in here keeps the SGR codes in the stream; the console renders them as spans
  // (ansiHtml() in index.html) rather than printing them. NO_COLOR still wins if the operator set
  // it — theme.mjs checks it first, and an operator who set NO_COLOR meant everywhere.
  // codeql[js/command-line-injection]: argv array, no shell:true — and every variable element is
  // allowlist-canonical, not merely allowlist-checked: proj is knownProjects()' own member
  // (triggerProject), opts.check is a closed-map constant, opts.repo is discovery's own copy of a
  // matched repo name (the /api/scan handler). Request strings select argv values; none supply one.
  // detached:true makes the child a PROCESS-GROUP LEADER, which is what makes stopping possible:
  // a fleet sweep fans out into per-area children (and those into scanners), so SIGTERM to the
  // parent pid alone would orphan a tree of running scanners while the panel reported "stopped" —
  // a claim contradicted by the CPU. With a group we can signal -pid and reach the whole tree.
  // NOT unref'd: this process still owns the pipes and still awaits exit.
  const p = spawn(args[0], args.slice(1), { cwd: CW, detached: true, env: { ...process.env, FORCE_COLOR: '3', CW_LANE_PROGRESS: '1', ...override?.env } }); // stdio piped (default)
  job.proc = p;
  let buf = '';
  const onData = (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { feed(job, buf.slice(0, i)); buf = buf.slice(i + 1); } };
  p.stdout.on('data', onData); p.stderr.on('data', onData);
  // `signal` is carried because a stopped job exits with code null — without it, a killed run and
  // a crashed one are indistinguishable in the record, and neither may borrow 'done'.
  const finish = (code, signal) => {
    if (buf) { feed(job, buf); buf = ''; }
    job.running = false; running[kind] = false;
    job.finishedAt = new Date().toISOString(); job.exitCode = code; job.signal = signal || null;
    // A lane still marked running when the process is gone did not finish — it was killed, crashed,
    // or the runner exited before emitting its `end`. It is moved to `abandoned`, NOT counted as
    // done and never as ok: a spinner that runs forever is the obvious bug, but silently rolling
    // these into `done` would be the dangerous one, because the lane would then read as having
    // completed a scan that produced nothing.
    for (const [check, r] of Object.entries(job.lanes || {})) {
      if (!r.running.length) continue;
      r.abandoned = (r.abandoned || 0) + r.running.length;
      r.abandonedRepos = [...new Set([...(r.abandonedRepos || []), ...r.running])];
      r.running = [];
      publish(job.kind, { lane: { check, event: 'abandoned', repo: null, status: null, ms: null,
        at: job.finishedAt, project: job.project || null, rec: r } });
    }
    // After the exit, not at the stop: by now the scan can start nothing more.
    if (job.stoppedAt && kind === 'scan-path') feed(job, removeScanContainers(job));
    if (job.stoppedAt) { job.phase = 'stopped'; feed(job, `[serve] stopped by ${job.stoppedBy} — this run published nothing for the areas it had not reached`); }
    else if (job.phase !== 'done' && (code === 0 || (REPORTING_EXITS[kind] || []).includes(code))) job.phase = 'done';
    publish(kind, { status: jobStatus(kind) });
    if (HEALTH_JOB_KINDS.has(kind)) persistJobs();
  };
  p.on('exit', (code, signal) => finish(code, signal));
  p.on('error', (e) => { feed(job, `[serve] spawn error: ${e.message}`); finish(-1); });
  return { started: true };
}

export function jobStatus(kind) {
  const j = jobs[kind]; if (!j) return null;
  return { running: j.running, startedAt: j.startedAt, finishedAt: j.finishedAt, exitCode: j.exitCode,
    phase: j.phase, done: j.done, total: j.total, current: j.current, batchDir: j.batchDir, seq: j.seq,
    lines: j.lines, label: j.label || null,
    project: j.project || null, repo: j.repo || null, fleet: !!j.fleet,
    // Per-lane state travels with the status so a client that connects MID-SWEEP sees the lanes
    // already running, rather than only those that happen to start after it subscribed.
    lanes: j.lanes || {},
    // a killed job exits with code null, so the SIGNAL is the only record of how it ended —
    // without it, "stopped" and "crashed" look identical in the status payload.
    signal: j.signal || null,
    // stoppedAt/stoppedBy travel so a HALTED run can never render as a completed one. A stopped
    // sweep published nothing for the areas it had not reached; that is a different state from
    // "finished", and the panel says which.
    stoppedAt: j.stoppedAt || null, stoppedBy: j.stoppedBy || null,
    interruptedAt: j.interruptedAt || null };
}

// ── WHO SEES WHICH JOB (operator ruling 2026-09-29) ─────────────────────────────────────────────
// A fleet run is shown only to a client in the fleet view (no selection). Any other run is shown
// only to a client whose picker selection names its project or repo. A scan-path run belongs to no
// area and is shown in every view, with its path and output directory redacted off the operator
// port. `project` is what the client selected, as label or slug; `operator` is the operator port.
export function jobScope({ project = '', operator = false } = {}) {
  const raw = String(project || '').trim();
  return { fleet: !raw, names: new Set([raw, raw && projectSlug(raw)].filter(Boolean)), operator: !!operator };
}

export function jobVisible(kind, scope) {
  const j = jobs[kind];
  if (!j) return true;                                   // never ran: the null status says so
  if (kind === 'scan-path') return true;
  if (j.fleet || !j.project) return scope.fleet;
  return scope.names.has(j.project) || (!!j.repo && scope.names.has(j.repo));
}

const REDACTED = '[redacted: shown on the operator port]';
/** fn(string) -> the string `scope` may see. Identity except a scan-path run off the operator port. */
export function redactorFor(kind, scope) {
  const secrets = (jobs[kind] && !scope.operator && jobs[kind].secrets) || [];
  if (!secrets.length) return (s) => s;
  const longestFirst = [...secrets].sort((a, b) => b.length - a.length);
  return (s) => (typeof s === 'string' ? longestFirst.reduce((acc, x) => acc.split(x).join(REDACTED), s) : s);
}

/** jobStatus(kind) as `scope` may see it: null when it is not theirs to see. */
export function jobStatusFor(kind, scope) {
  if (!jobVisible(kind, scope)) return null;
  const st = jobStatus(kind);
  if (!st) return null;
  const r = redactorFor(kind, scope);
  return { ...st, label: r(st.label), current: r(st.current), batchDir: r(st.batchDir), lines: st.lines.map(r) };
}

// ── STOP: halt a running job, and say so honestly ───────────────────────────────────────────────
// SIGTERM to the process group first (see the detached note in trigger) so the sweep's own children
// get a chance to unwind; SIGKILL after a grace window for anything that ignored it. The job is
// marked stopped BEFORE signalling, so the exit handler cannot race it into looking like a clean
// finish — a run killed mid-flight must never report phase 'done'.
//
// What deliberately does NOT happen here: the area's `.sweep-inflight.json` marker is left in
// place. A stopped sweep did not publish its rollup, and the marker is precisely the record of
// that. Clearing it on the way out would erase the evidence that an area's state is now unknown.
const STOP_GRACE_MS = 5000;
export function stopJob(kind, { by = 'operator' } = {}) {
  const j = jobs[kind];
  if (!j || !j.running) return { stopped: false, reason: 'nothing running' };
  if (!j.proc || typeof j.proc.pid !== 'number') return { stopped: false, reason: 'no process handle — cannot stop what we cannot signal' };
  // The scan's owner label is <pid>.<start>; its start is read while the process is still alive,
  // so the containers can be matched to THIS run once it is gone (monitor/containers.mjs).
  if (kind === 'scan-path') j.owner = { pid: j.proc.pid, startSec: procIo.startedAt(j.proc.pid) };
  j.stoppedAt = new Date().toISOString();
  j.stoppedBy = by;
  j.phase = 'stopped';
  feed(j, `[serve] STOP requested by ${by} — signalling the process group`);
  const signal = (sig) => {
    // negative pid = the whole process group. ESRCH just means it already exited.
    try { process.kill(-j.proc.pid, sig); return true; }
    catch (e) { if (e.code === 'ESRCH') return false; try { j.proc.kill(sig); return true; } catch { return false; } }
  };
  const reached = signal('SIGTERM');
  setTimeout(() => { if (j.running) { feed(j, `[serve] still running after ${STOP_GRACE_MS}ms — SIGKILL`); signal('SIGKILL'); } }, STOP_GRACE_MS).unref?.();
  publish(kind, { status: jobStatus(kind) });
  if (HEALTH_JOB_KINDS.has(kind)) persistJobs();
  return { stopped: true, signalled: reached, kind, note: 'the in-flight marker is left in place: a stopped sweep published nothing, and liveness must keep saying so' };
}

// Only the containers this scan's process started, matched by its owner label. Anything this
// cannot remove is left for the next sweep's reaper, which removes it once the owner is dead.
function removeScanContainers(job) {
  const later = 'left for the next sweep, which removes a container whose owner is gone';
  if (!job.owner || job.owner.startSec == null) return `[serve] could not read the scan's start time, so no container was matched to it; any it started are ${later}`;
  const r = killOwned(job.owner);
  if (r.unread) return `[serve] docker could not be listed; any container the scan started is ${later}`;
  if (!r.names.length) return '[serve] the scan had no containers to remove';
  return `[serve] removed ${r.killed.length} container(s) the scan started${r.killed.length ? `: ${r.killed.join(', ')}` : ''}`
    + (r.failed.length ? `; ${r.failed.length} could not be removed and are ${later}: ${r.failed.join(', ')}` : '');
}
