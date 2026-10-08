// admin/routes/jobs.mjs — the job-control surface: the live console stream, job status, sweep, scan,
// stop, BOLA and STPA runs, fleet health triggers and measured lane timing. The job table itself
// lives in admin/lib/jobs.mjs; this file is its HTTP adapter.

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectSlug } from '../../monitor/project-scope.mjs';
import { areaBySlug, areaOut } from '../../monitor/registry.mjs';
import { resolveRepos } from '../../monitor/discover.mjs';
import { checkForScanner, SCANNER_CHECKS, RUNTIME_CATEGORIES } from '../../monitor/scanner-checks.mjs';
import { jobs, running, jobSubs, sseSlots, LOG_CAP, trigger, triggerProject, stopJob, jobScope, jobVisible, jobStatusFor, redactorFor } from '../lib/jobs.mjs';
import { nowISO as issuesNowISO } from '../../monitor/issue-store.mjs';
import { fleet as bolaFleet, bolaAreas } from '../../monitor/bola-fleet.mjs';
import { laneTiming, batchArea } from '../../monitor/lane-timing.mjs';
import { CW } from '../lib/core.mjs';

// fact: bound once at boot by initJobRoutes
let registry = () => { throw new Error('jobs.mjs used before initJobRoutes'); };
let registryStale = () => { throw new Error('jobs.mjs used before initJobRoutes'); };

// contract: run once at boot, before the first request
export function initJobRoutes(deps) {
  ({ registry, registryStale } = deps);
}

// The check ids a lane-scoped sweep may name. Derived from SCANNER_CHECKS (already imported above),
// so a lane added there is runnable here without a second list learning about it.
const KNOWN_CHECKS = new Set(Object.values(SCANNER_CHECKS));
// A full pass over the run records is ~1s across 3,291 files, which is fine once and wasteful on
// every poll. Bounded to a handful of windows and short-lived, so a sweep that has just finished
// shows up within the minute rather than being cached behind yesterday's answer.
const laneTimingTtlMs = () => Number(process.env.CW_LANE_TIMING_TTL_MS || 45_000);
// Derived from the evidence rather than from a second registry: an area is real for timing purposes
// if the run records carry a batch for it. `100randomrepos`-style corpora are swept without being
// declared, and a declared-areas-only check would refuse to graph the very batches on disk.
function areaHasBatches(root, area) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .some((d) => d.isDirectory() && (d.name === area || batchArea(d.name) === area));
  } catch { return false; }
}
const LANE_TIMING_CACHE_MAX = 24;
const laneTimingCache = new Map();

// fact: `kind` is a key into a closed set, never a value passed through
const STOPPABLE = new Set(['sweep', 'bola', 'scan-path', 'health-all', 'health-deadcode', 'health-toolchain', 'health-provenance', 'health-gates']);

// fleet health triggers: POST /api/health/<deadcode|toolchain|provenance|gates|all>
const HEALTH_KINDS = ['deadcode', 'toolchain', 'provenance', 'gates', 'all'];
const healthTrigger = (kind) => ({ send, query }) => send(200, trigger(`health-${kind}`, query.get('project')));

export const routes = [
  // ── GET /api/status/events — the live console, streamed ─────────────────────────────────────
  // Replaces a 1200ms poll that re-rendered all 400 retained lines on every tick. Each line is
  // delivered once, tagged with its `seq`; a reconnecting browser sends Last-Event-ID and gets
  // exactly the gap. The whole-status frame still rides the same stream so progress, phase and
  // the finished/exit transition arrive without a second request.
  //
  // It is a GET, so it passes the CSRF gate by definition (that gate exempts GET precisely because
  // GETs must stay side-effect free — this one is a read). The session check above still applies.
  // The connection cap matters: nothing else on this panel bounds concurrent GETs, and an SSE
  // response holds its socket open indefinitely.
  //
  // Scoped per connection (operator ruling 2026-09-29): the client sends its picker selection as
  // `project` and gets only the job that selection may see (jobVisible), redacted as jobStatusFor
  // says. Visibility is re-read at every event, because the slot's job is replaced on each start.
  { method: 'GET', path: '/api/status/events', handle: ({ req, res, send, isLoopbackReq }) => {
    if (sseSlots.full()) return send(429, { ok: false, error: `all ${sseSlots.cap} event-stream slots are connected` });
    sseSlots.acquire();
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
    });
    res.write('retry: 3000\n\n');

    const params = new URL(req.url, 'http://127.0.0.1').searchParams;
    const kind = params.get('kind') || 'sweep';
    const scope = jobScope({ project: params.get('project'), operator: !!isLoopbackReq });
    const frame = (event, data, id) => res.write(`${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    // Replay: everything after the client's last seen seq. The retained window is LOG_CAP lines,
    // so a client that was away longer than that is told so rather than silently handed a hole.
    const from = Number(req.headers['last-event-id'] ?? params.get('from') ?? 0) || 0;
    const j = jobs[kind];
    if (j && jobVisible(kind, scope)) {
      const r = redactorFor(kind, scope);
      const firstRetained = j.seq - j.lines.length + 1;
      if (from > 0 && firstRetained > from + 1) {
        frame('gap', { from, firstRetained, dropped: firstRetained - from - 1,
          why: `the retained window is ${LOG_CAP} lines and this client was away longer` });
      }
      j.lines.forEach((line, i) => { const seq = firstRetained + i; if (seq > from) frame('line', { seq, line: r(line) }, seq); });
      frame('status', jobStatusFor(kind, scope));
    } else {
      // Never ran, or not this selection's to see: a declared absence either way, not an empty stream.
      frame('status', null);
    }

    const unsub = (fn) => jobSubs.delete(fn);
    const sub = (k, payload) => {
      if (k !== kind || !jobVisible(kind, scope)) return;
      if (payload.line !== undefined) frame('line', { seq: payload.seq, line: redactorFor(kind, scope)(payload.line) }, payload.seq);
      else if (payload.lane !== undefined) frame('lane', payload.lane);
      // Explicit, not a fallthrough: the `else` below frames the status, and a lane payload
      // arriving here would be sent as `status: undefined` — a frame the client drops on `if(!sw)`.
      // The stream would look healthy and the lanes would simply never move.
      else frame('status', jobStatusFor(kind, scope));
    };
    jobSubs.add(sub);
    // 15s heartbeat: an idle stream is dropped by intermediaries, and a sweep can sit quiet for
    // minutes between scanners. Under the /svc/* bridge the upstream idle timeout is 4s, so a
    // stream routed through that path would need a faster beat — this route is not bridged.
    const hb = setInterval(() => res.write(':hb\n\n'), 15_000);
    hb.unref?.();
    let closed = false;
    const cleanup = () => { if (closed) return; closed = true; clearInterval(hb); unsub(sub); sseSlots.release(); };
    res.on('close', cleanup); req.on('close', cleanup); res.on('error', cleanup);
    return undefined;
  } },
  // Scoped like the stream: `project` is the client's selection, and a job it may not see is null
  // here and absent from `running`.
  { method: 'GET', path: '/api/status', handle: ({ req, send, isLoopbackReq }) => {
    const scope = jobScope({ project: new URL(req.url, 'http://127.0.0.1').searchParams.get('project'), operator: !!isLoopbackReq });
    const see = (k) => jobStatusFor(k, scope);
    const healthKinds = ['health-all', 'health-deadcode', 'health-toolchain', 'health-provenance', 'health-gates'];
    const health = healthKinds.map((k) => ({ kind: k, ...see(k) })).filter((j) => j.startedAt);
    const seen = Object.fromEntries(Object.entries(running).filter(([k]) => jobVisible(k, scope)));
    // registryStale is surfaced, not swallowed: while the panel serves a last-good snapshot the
    // operator is reading numbers that describe a registry they may have already replaced, and
    // that is precisely the kind of thing this platform exists to refuse to hide.
    return send(200, { running: seen, sweep: see('sweep'), bola: see('bola'), stpa: see('stpa'), registryStale: registryStale(), health: health.find((j) => j.running) || health.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0] || null });
  } },
  { method: 'POST', path: '/api/sweep/stop', handle: ({ req, send, isLoopbackReq }) => {
    const q = new URLSearchParams((req.url.split('?')[1]) || '');
    const kind = q.get('kind') || 'sweep';
    if (!STOPPABLE.has(kind)) return send(400, { stopped: false, reason: `unknown job kind ${JSON.stringify(kind)}`, known: [...STOPPABLE] });
    // A scan-path run is started only from the operator port (admin/routes/scan-path.mjs), and the
    // published port holds no control over it either.
    if (kind === 'scan-path' && !isLoopbackReq) return send(403, { stopped: false, reason: 'a scan-path run is stopped only from the operator port' });
    return send(200, stopJob(kind));
  } },
  // GET /api/lane-timing — measured per-lane duration history. Distinct from /api/perf, which is
  // what the tuning model PREDICTS a lane will cost: one is a specification and the other is a
  // record of runs, and a page that showed them in the same table would invite the first to be read
  // with the second's authority.
  { method: 'GET', path: '/api/lane-timing', handle: ({ req, send }) => {
    const q = new URLSearchParams((req.url.split('?')[1]) || '');
    const root = resolve(CW, registry().reportsRoot || 'reports');
    // The area is resolved through the SAME allowlist every other scoped route uses; an
    // unrecognised name yields null, and null means "no area filter" nowhere — it means the
    // request is refused, because falling through to the unfiltered fleet would answer a question
    // about one project with every project's numbers.
    const asked = q.get('project') || '';
    let area = null;
    if (asked) {
      const slug = projectSlug(asked);
      area = areaOut(slug, registry()) || slug;
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(area)) return send(400, { error: `unrecognised project ${JSON.stringify(asked)}` });
      // A name that resolves to no declared area AND names no batch on disk is REFUSED rather than
      // answered with an empty series. `{}` for a project nobody has heard of renders as "this
      // project has no slow lanes", which is a measurement it never took — the unsupported pass swap,
      // in a table whose whole subject is what things cost. Known-but-never-swept still answers
      // 200 with an empty series, and the panel says so in words.
      const declared = !!areaBySlug(slug, registry());
      if (!declared && !areaHasBatches(root, area)) {
        return send(404, { error: `no area or batch named ${JSON.stringify(area)} — nothing has been `
          + 'recorded under that name, which is not the same as it having been measured and found fast' });
      }
    }
    const since = q.get('since') || null;
    const until = q.get('until') || null;
    const key = `${root}|${area || ''}|${since || ''}|${until || ''}`;
    const now = Date.now();
    const hit = laneTimingCache.get(key);
    if (hit && now - hit.at < laneTimingTtlMs()) return send(200, { ...hit.val, cached: true });
    let val;
    // Fail closed: a read error is not an empty history. The panel must show that it could not
    // measure, never a graph with no points that reads as a lane nobody has ever run.
    try { val = laneTiming({ root, area, since, until }); }
    catch (e) { return send(500, { error: `could not read the run records: ${e.message}` }); }
    // `since`/`until` come from the request, so the key space is caller-controlled and the map
    // would grow without bound on a stream of distinct windows. Oldest-first eviction at a small
    // cap: this is a cache, and losing an entry costs a re-read.
    if (laneTimingCache.size >= LANE_TIMING_CACHE_MAX) {
      for (const k of [...laneTimingCache.keys()].slice(0, laneTimingCache.size - LANE_TIMING_CACHE_MAX + 1)) laneTimingCache.delete(k);
    }
    laneTimingCache.set(key, { at: now, val });
    return send(200, { ...val, cached: false });
  } },
  { method: 'POST', path: '/api/sweep', handle: ({ req, send }) => {
    const q = new URLSearchParams((req.url.split('?')[1]) || '');
    // `check` narrows the sweep to ONE lane, which is what the empty-lane panel offers. Validated
    // against the declared check ids and refused otherwise — not for shell safety (the job is
    // argv-spawned, never a shell string) but because monitor/sweep.mjs reads an unrecognised first
    // argument as a GROUP NAME and starts a real scan on it. An unvalidated value here would not
    // fail; it would quietly run something other than what the button said.
    const check = q.get('check');
    if (check !== null) {
      if (!KNOWN_CHECKS.has(check)) {
        return send(400, { started: false, reason: `unknown check ${JSON.stringify(check)} — sweep.mjs would read it as a group name and scan something else`, known: [...KNOWN_CHECKS].sort().slice(0, 12) });
      }
      return send(200, trigger('sweep', q.get('project'), { check, label: `lane · ${check}` }));
    }
    return send(200, trigger('sweep', q.get('project')));
  } },
  // ── BOLA tab: present + run ────────────────────────────────────────────────────────────────────
  // GET /api/bola  → one row per area that DECLARES a bola block (monitor/projects.json), each with
  //   its credential readiness and the latest persisted run (reports/<out>/bola-latest.json). Lazy,
  //   NOT on the /api/state poll: it reads the secrets table + an evidence file per area, which has no
  //   place on an 8-second cadence. Fail-closed shapes (unreadable manifest / invalid evidence) pass
  //   straight through so the tab can render them as their own state rather than as clean.
  { method: 'GET', path: '/api/bola', handle: ({ send }) => {
    try { return send(200, { generated: issuesNowISO(), areas: bolaFleet() }); }
    catch (e) { return send(500, { error: e.message }); }
  } },
  // POST /api/stpa/run?project=<slug> → runs monitor/stpa-sweep.mjs, re-deriving the admin-panel/
  //   remediation control loop from CURRENT source and classifying it against the fixed UCA/HAZOP
  //   table (evaluations/SPEC-stpa-hazop-control-loop-panel-2026-09-01.md). No credential gate: unlike
  //   bola, this reads only local source files, so there is no readiness state to check.
  { method: 'POST', path: '/api/stpa/run', handle: ({ req, send }) => {
    const slug = triggerProject(new URL(req.url, 'http://127.0.0.1').searchParams.get('project') || '');
    return send(200, trigger('stpa', slug, { label: 'STPA/HAZOP control loop' }));
  } },
  // POST /api/bola/run?project=<slug> → run bola-sweep for ONE declared, READY area. Refused for an
  //   area that is not declared or whose secrets are not configured — the run would only record a void,
  //   and offering it would read as "ready" when it is not. CSRF + same-origin already enforced above.
  { method: 'POST', path: '/api/bola/run', handle: ({ req, send }) => {
    const slug = projectSlug(new URL(req.url, 'http://127.0.0.1').searchParams.get('project') || '') || new URL(req.url, 'http://127.0.0.1').searchParams.get('project') || '';
    const area = bolaAreas(registry()).find((a) => a.slug === slug);
    if (!area) return send(400, { started: false, reason: `"${slug}" declares no bola block — configured areas: ${bolaAreas(registry()).map((a) => a.slug).join(', ') || 'none'}` });
    const rows = bolaFleet();
    const row = rows.find((r) => r.slug === slug);
    if (!row || !row.readiness.ready) return send(409, { started: false, reason: row ? `credentials not configured: ${row.readiness.reason}` : 'area not resolvable' });
    return send(200, trigger('bola', slug, { label: `BOLA · ${area.label}` }));
  } },
  // ── targeted re-scan: one scanner, or one repo ────────────────────────────────────────────────
  // POST /api/scan?project=X&scanner=<category>          → that scanner, across the project
  // POST /api/scan?project=X&repo=<name>                 → every scanner, for that one repo
  // POST /api/scan?project=X&scanner=<c>&repo=<n>        → both narrowings at once
  //
  // The ⏺ buttons in the panel's Scanner coverage and Fleet tables. This endpoint EXECUTES, so it
  // is written to the house rule that declaration is split from authority:
  //
  //   · `scanner` is a key lookup into the frozen SCANNER_CHECKS map, never a value passed through.
  //     Whatever the caller sends, what reaches the sweep is one of twelve compile-time constants,
  //     or the request is refused. checkForScanner() uses hasOwnProperty, so `__proto__` and
  //     `constructor` resolve to null like any other unknown key rather than to a function.
  //   · `repo` is checked against the repos discovery actually resolves — an existence test against
  //     real state, not a charset guess — and sweep.mjs independently refuses a repo outside the
  //     scoped area, so neither layer is load-bearing alone.
  //   · nothing is interpolated into a shell: trigger() spawns an argv array, no shell:true.
  //
  // A scan cannot start while a sweep is running (same job slot) — trigger() reports that back.
  { method: 'POST', path: '/api/scan', handle: ({ req, send }) => {
    const q = new URLSearchParams((req.url.split('?')[1]) || '');
    const scanner = q.get('scanner') || '';
    const repo = q.get('repo') || '';
    if (!scanner && !repo) return send(400, { started: false, reason: 'name a scanner, a repo, or both' });

    let check = null;
    if (scanner) {
      check = checkForScanner(scanner);
      if (!check) return send(400, { started: false, reason: `unknown scanner ${JSON.stringify(scanner)}`, known: Object.keys(SCANNER_CHECKS) });
    }
    let repoName = null;
    if (repo) {
      // Existence test against real state, and — same rule as triggerProject() — what goes forward
      // is discovery's own copy of the name, not the query string that matched it.
      let match = null;
      try { match = resolveRepos(registry(), { selfRoot: CW }).repos.find((r) => r.name === repo) || null; }
      catch { return send(503, { started: false, reason: 'repo list unavailable — registry unreadable' }); }
      if (!match) return send(400, { started: false, reason: `unknown repo ${JSON.stringify(repo)}` });
      repoName = match.name;
    }
    const label = [check ? `scanner ${scanner}` : 'all scanners', repoName ? `repo ${repoName}` : null].filter(Boolean).join(' · ');
    const res = trigger('sweep', q.get('project'), { check, repo: repoName, label });
    // A runtime scanner with no live URL will start, skip, and finish clean — which reads as "ran,
    // found nothing". Say so up front rather than let the operator infer a green from a no-op.
    if (res.started && scanner && RUNTIME_CATEGORIES.includes(scanner)) {
      res.note = 'runtime scanner — records itself as skipped unless a live URL is configured for this area';
    }
    return send(200, res);
  } },
  ...HEALTH_KINDS.map((kind) => ({ method: 'POST', path: `/api/health/${kind}`, handle: healthTrigger(kind) })),
];
