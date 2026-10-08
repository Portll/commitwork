#!/usr/bin/env node
// commitwork monitor — scheduled cross-project sweep.
// Runs `commitwork run <group>` over every registered project, then rolls the results up.
// usage: node monitor/sweep.mjs [group] [project|--all] [--dry] [--jobs N] [--exclude slug[,slug…]]
//   group   : all (default) | fast | supply-chain | deep
//   --exclude: drop whole AREAS from this run. Repeatable, comma-separated. Run-scoped and
//             recorded as such — distinct from the registry's permanent `exclude`.
//   project : a registry entry, a discovered repo, or an AREA slug. Omitted ⇒ the ACTIVE project
//             (the registry's primary area) — NOT the whole machine. --all sweeps every project.
import { processState } from '../lib/pid-alive.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync, execFile, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { resolveRepos } from './discover.mjs';
import { loadRegistry, areaBySlug, primaryArea } from './registry.mjs';
import { outDirFor } from './area.mjs'; // the OUT resolver — never re-derive the chain here
import { annotationsPathFor } from './store-paths.mjs';
import { runLens as sandboxCoverage, summaryLine as sandboxCoverageLine } from './sandbox-coverage.mjs';
import { acquireSweepSlot, DEFAULT_SLOTS } from './sweep-slot.mjs'; // bounded concurrency — see its header for the measurements
import { getSetting } from './settings.mjs';       // env > store > default, read at CALL time
import { resolveTuning } from './perf-tuning.mjs'; // the panel's recommendation, finally consumed
import { appendRecord } from '../bin/lib/verdict-journal-core.mjs';
import { scannedGit } from '../bin/lib/git-env.mjs';
import { rollupOutcome, buildAreaVerdict, buildFleetVerdict, scanOutcome, sweepExit, canaryVerdict } from './sweep-verdict.mjs';
import { readExportHealth, exportVerdict, exportHealthLine, skippedExport } from './memory-export-health.mjs';
import { areaSlugOf } from './project-scope.mjs';
import { resolveExcludedAreas, fleetAreaSlugs, pausedAreas, allScopeArea } from './sweep-scope.mjs'; // one source for the --all area list
import {
  inventory as hostInventory, reconcile as reconcileHostInventory, writeInventory as writeHostInventory,
} from './host-inventory.mjs';
import { solveDir as solveNuclei, writeSolved } from './nuclei-solve.mjs';
import { ensureFirstRunSetup } from '../bin/setup.mjs';
// The literal text `[sweep]` must stay — operators and the panel's phase parser grep for it.
import { acc, dim, mut, live, crit, part, bold } from '../bin/lib/theme.mjs';
import { warmImages, manifestImages } from './images.mjs'; // one bounded pull per image per sweep
import { reapOrphans } from './containers.mjs'; // containers a dead slice left running
import { runAreaChild, TAIL_BYTES } from './area-child.mjs'; // process-group kill; resolves even if a descendant keeps the pipe
import { useScopedDockerConfig } from '../lib/docker-config.mjs';
import { exitFlushed } from '../lib/exit-flushed.mjs'; // --dry, the fleet tails and a sweep's own log outrun a pipe; a bare exit truncates it
// Point docker/trivy/grype at commitwork's own docker config before anything spawns them, so a
// hand-run sweep is as quiet as the scheduled one. The agents get this declared on the plist;
// everything else got it from nowhere, which is the gap that left the prompt appearing.
useScopedDockerConfig();

const TAG = acc('[sweep]');

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');

// first interactive launch: offer to install missing scanners before sweeping
// (no-op under launchd/CI — non-TTY never prompts; children are suppressed via CW_SKIP_SETUP)
await ensureFirstRunSetup();

// Value-taking flags must have their value skipped or it lands in the positional list.
const VALUE_FLAGS = new Set(['--jobs', '--repo', '--exclude']);
const pos = (() => {
  const out = [], argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (VALUE_FLAGS.has(argv[i])) { i++; continue; }   // skip the flag AND its value
    if (!argv[i].startsWith('--')) out.push(argv[i]);
  }
  return out;
})();
const group = pos[0] || 'all';
const sweepAll = process.argv.includes('--all');
const reg = loadRegistry();
const START_MS = Date.now();
const START_ISO = new Date(START_MS).toISOString();
const stamp = new Date(START_MS).toISOString().replace(/[-:T]/g, '').slice(0, 14);

// ── scope: the ACTIVE project ───────────────────────────────────────────────────────────────
// Default scope is the active project (registry primary area); --all is the whole-machine opt-in.
const arg = pos[1];
const argArea = arg && (areaBySlug(arg, reg) ? arg : areaSlugOf(arg));
// Refusals happen before an area resolves, so they land at the reports root. Structured only
// (tunnel-served tree), best-effort — a refusal record must never mask the refusal itself.
const journalRefusal = (reason, detail) => {
  try {
    appendRecord(process.env.CW_SWEEP_REFUSALS || join(CW, reg.reportsRoot || 'reports', 'sweep-refusals.jsonl'), {
      v: 1, kind: 'sweep-refusal', at: new Date().toISOString(), reason,
      detail: String(detail ?? '').startsWith('/') ? '(path argument)' : String(detail ?? '').slice(0, 120),
      group, exit: 2,
    });
  } catch { /* never block or mask the refusal */ }
};
// An unresolvable scope is refused, never silently defaulted.
if (arg && !sweepAll && !argArea) {
  console.error(`${TAG} cannot resolve '${arg}' to an area — refusing to guess a scope.\n` +
    `        known areas: ${(reg.areas || []).map((a) => a.slug).join(', ') || '(none declared)'}\n` +
    `        use a registry project name, a discovered repo name, an area slug, or --all.`);
  journalRefusal('unresolvable-scope', arg);
  process.exit(2);
}
// For a scoped run this is final. For --all it is PROVISIONAL: `--exclude` has not been parsed
// yet, so the primary area here may be the one this run was told to skip. Re-derived below from
// fleetAreaSlugs, the same list the fan-out uses.
let scopeArea = sweepAll ? (primaryArea(reg)?.slug || null) : (argArea || primaryArea(reg)?.slug || null);
// An area name is not a repo name — filter by area membership, not `only`.
const only = sweepAll ? null : (arg && !areaBySlug(arg, reg) ? arg : null);

const EXCLUDE = new Set(reg.exclude || []); // retired/non-deployed services dropped from scan scope

// `--exclude <slug[,slug…]>` drops whole AREAS from THIS run. Deliberately NOT folded into
// reg.exclude: that list means "outside every sweep, forever", and a run-scoped skip that reported
// itself the same way would make a partial sweep indistinguishable from a complete one.
// Resolution matches the area filter below — `r.area || areaSlugOf(r.name)` — because `.area` is
// unset for almost every repo (100 of 101 on 2026-08-24), and a predicate reading bare `.area` is
// the exact defect fixed 2026-08-24 in the preflight build guard: it looks correct and excludes nothing.
const excludedAreas = (() => {
  const raws = [];
  for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === '--exclude') raws.push(process.argv[i + 1]);
  const { areas, unresolved } = resolveExcludedAreas(raws, reg);
  // Fail closed. A typo must never silently sweep the area you meant to skip — clientA is 34
  // projects and a measured 10h+ run, so "it quietly did not match" is the expensive failure.
  for (const raw of unresolved) {
    console.error(`${TAG} --exclude ${JSON.stringify(raw)} does not resolve to a known area — refusing to run.\n` +
      `        A typo here sweeps exactly what you meant to skip.\n` +
      `        known areas: ${(reg.areas || []).map((a) => a.slug).join(', ') || '(none declared)'}`);
    journalRefusal('unresolvable-exclusion', raw);
    process.exit(2);
  }
  return areas;
})();
// The areas --all will actually fan out to. ONE source, shared with the fleet loop below — see
// monitor/sweep-scope.mjs for why that is structural rather than stylistic.
const fleetSlugs = fleetAreaSlugs(reg, excludedAreas);
// #7: fleet-level artefacts must not land in an area this run excluded. Symptom was fresh files
// under reports/<excluded-area> while that area's own scan went stale — the data was correct and
// only its ADDRESS was wrong, so no scan-result check could see it.
if (sweepAll) {
  const resolved = allScopeArea(reg, excludedAreas);
  if (resolved !== scopeArea) {
    console.log(`${TAG} --all out dir moves ${bold(scopeArea || '(none)')} -> ${bold(resolved || '(none)')} `
      + dim('· the primary area is excluded or paused for this run'));
  }
  scopeArea = resolved;
}
// repo list: registry entries + root auto-discovery, lifecycle-gated — semantics in discover.mjs
let { repos, superseded, notes } = resolveRepos(reg, { only, selfRoot: CW, stamp });
// area filter: keep only repos belonging to the scoped area (unless --all).
if (!sweepAll && scopeArea) repos = repos.filter((r) => (r.area || areaSlugOf(r.name)) === scopeArea);
// Declared pauses: the standing form of --exclude. Applied to the fleet fan-out (fleetAreaSlugs)
// AND to the repo list here, or `--all` would skip the child sweep while the parent still scanned
// the area's repos itself. Naming a paused area explicitly still runs it — a pause is a default,
// not a lock — but it says so, because a run that silently honoured or silently ignored the
// declaration are the two ways this becomes untrustworthy.
const pausedNow = pausedAreas(reg);
if (pausedNow.length) {
  const pausedSet = new Set(pausedNow.map((p) => p.slug));
  const named = scopeArea && pausedSet.has(scopeArea);
  for (const p of pausedNow) {
    const mine = p.slug === scopeArea;
    // Clipped: the reason belongs in the registry, and a paragraph on every run trains people to
    // skip the line. What must survive is that it IS paused, since when, and the gist.
    const why = p.reason.length > 110 ? `${p.reason.slice(0, 109)}…` : p.reason;
    console.log(`${TAG} area ${bold(p.slug)} is PAUSED since ${p.since} ${dim(`— ${why}`)}`
      + (mine ? ` ${bold('· running anyway: you named it')}` : ''));
  }
  if (!named) {
    const before = repos.length;
    repos = repos.filter((r) => !pausedSet.has(r.area || areaSlugOf(r.name)));
    const dropped = before - repos.length;
    if (dropped) console.log(`${TAG} ${dim(`${dropped} repo(s) dropped as paused`)}`);
    // Refuse ONLY when the pause is what emptied the scope. An unconditional !repos.length here
    // hijacked every other reason a scope can be empty — an unknown project name resolves to zero
    // repos by design, and this exited 2 on it.
    if (dropped && !repos.length) {
      console.error(`${TAG} every repo in scope is paused — refusing to run an empty sweep, which would publish as a completed one.`);
      journalRefusal('all-repos-paused', [...pausedSet].join(','));
      process.exit(2);
    }
  }
}
// Area exclusions: applied after the area filter and before --repo, so they can only narrow.
if (excludedAreas.size) {
  const before = repos.length;
  const dropped = repos.filter((r) => excludedAreas.has(r.area || areaSlugOf(r.name)));
  repos = repos.filter((r) => !excludedAreas.has(r.area || areaSlugOf(r.name)));
  console.log(`${TAG} --exclude ${bold([...excludedAreas].join(', '))} ${dim(`(${dropped.length} of ${before} repo(s) dropped from this run)`)}`);
  if (!repos.length) {
    console.error(`${TAG} every repo in scope was excluded — refusing to run an empty sweep, which would publish as a completed one.`);
    journalRefusal('all-repos-excluded', [...excludedAreas].join(','));
    process.exit(2);
  }
}
// `--repo <name>` narrows an area-scoped sweep to one repo. Applied after the area filter, so it
// narrows and never widens.
const repoIdx = process.argv.indexOf('--repo');
const onlyRepo = repoIdx > -1 ? process.argv[repoIdx + 1] : null;
if (onlyRepo) {
  const before = repos.length;
  repos = repos.filter((r) => r.name === onlyRepo);
  if (!repos.length) {
    console.error(`${TAG} --repo ${JSON.stringify(onlyRepo)} matches no repo in scope ${JSON.stringify(scopeArea || 'unscoped')} (${before} candidate(s)) — refusing to widen the scope to find it.`);
    journalRefusal('repo-not-in-scope', onlyRepo);
    process.exit(2);
  }
  console.log(`${TAG} --repo ${bold(onlyRepo)} ${dim(`(1 of ${before} in scope)`)}`);
}
for (const n of notes) console.log(`${TAG} ${n}`);

// Output routing: the swept area owns its report area. An explicit caller CW_MONITOR_OUT still
// wins. outDirFor throws on an unresolvable area — a write to a guessed directory is refused.
const OUT_DIR = (() => {
  try { return outDirFor(scopeArea, reg); }
  catch (e) { console.error(`${TAG} ${e.message}`); journalRefusal('unresolvable-out-dir', scopeArea); process.exit(2); }
})();
const childEnv = { ...process.env, CW_MONITOR_OUT: OUT_DIR };
// races scan: driven by the area's declared `races` flag; --project must resolve in the registry.
const racesAreaDef = scopeArea ? areaBySlug(scopeArea, reg) : null;
const racesArea = racesAreaDef?.races
  ? ((racesAreaDef.members || []).find((m) => (reg.projects || []).some((p) => p.name === m)) || scopeArea)
  : null;
const RACES_ENGINES = process.env.CW_RACES_ENGINES || 'semgrep,spotbugs';
console.log(`${TAG} scope=${bold(sweepAll ? 'ALL PROJECTS' : (scopeArea || 'unscoped'))} ${dim('·')} out=${mut(OUT_DIR.replace(CW + '/', ''))}`);

// --dry: resolve the project list (explicit + root auto-discovery) and print it, run nothing
if (process.argv.includes('--dry')) {
  for (const r of repos) {
    console.log(`  ${r.name}  [${[].concat(r.manifest).join('+')}]  ${r.source}  ${r.path}${r.url ? `  url=${r.url}` : ''}${existsSync(r.path) ? '' : '  (missing)'}`);
  }
  // Superseded is a label, not an exclusion — states which scanned repos are on standby.
  const scanned = new Set(repos.map((r) => r.name));
  for (const [n, lc] of Object.entries(superseded)) {
    const where = scanned.has(n) ? 'scanned, on rollback standby' : 'NOT scanned (scanSuperseded:false)';
    console.log(`  ${n}  superseded by ${lc.supersededBy || '?'} — ${where}`);
  }
  // --all does NOT use the repo list above — it fans out one child sweep PER AREA. Print that plan
  // too: a dry run that reports a different scope from the real run is worse than no dry run.
  if (sweepAll) {
    console.log(`${TAG} --all fans out per AREA: ${fleetSlugs.length} of ${(reg.areas || []).length}`
      + (excludedAreas.size ? ` ${dim(`(excluded: ${[...excludedAreas].join(', ')})`)}` : ''));
    // `areas:` marks the list itself, so a reader never has to trust line adjacency.
    console.log(`  areas: ${fleetSlugs.join(' ')}`);
  }
  console.log(`${TAG} dry run: ${repos.length} projects · group=${group}`);
  // The plan and this summary come LAST, after one line per repo, so a truncated pipe loses
  // exactly them.
  await exitFlushed(0);
}

// ── FLEET MODE: --all fans out one properly-scoped sweep PER AREA ───────────────────────────
// Each child writes its own out dir and takes its own per-area lock; --jobs N bounds concurrency.
// CW_SWEEP_CHILD=1 marks children so fleet-wide finalise steps run once here, not N times;
// per-area steps (rollup, liveness, overwatch-layer export) still run in each child.
if (sweepAll && !process.env.CW_SWEEP_CHILD) {
  const slugs = fleetSlugs;
  const jobsIdx = process.argv.indexOf('--jobs');
  const jobs = jobsIdx > -1 ? Math.max(1, Number(process.argv[jobsIdx + 1]) || 1) : 1;
  console.log(`${TAG} fleet: ${slugs.length} areas, ${jobs} at a time`);
  // Stream to disk, never to a buffer: per-area log file + bounded in-memory tail for the summary.
  const logDir = join(CW, reg.reportsRoot || 'reports');
  mkdirSync(logDir, { recursive: true });
  // A child that never exits holds a worker slot forever — hence the timeout.
  const AREA_TIMEOUT_MS = Math.max(60_000, Number(process.env.CW_SWEEP_AREA_TIMEOUT_MS) || 4 * 60 * 60 * 1000);
  const queue = [...slugs];
  const results = [];
  const worker = async () => {
    for (;;) {
      const slug = queue.shift();
      if (!slug) return;
      const t0 = Date.now();
      const logPath = join(logDir, `sweep-${stamp}-${slug}.log`);
      const out = await runAreaChild({
        command: 'node', args: [fileURLToPath(import.meta.url), group, slug],
        env: { ...process.env, CW_SWEEP_CHILD: '1' }, logPath, timeoutMs: AREA_TIMEOUT_MS,
      });
      const secs = Math.round((Date.now() - t0) / 1000);
      results.push({ slug, code: out.code, secs, timedOut: out.timedOut, stdioHeld: out.stdioHeld, logPath });
      console.log(`\n===== ${slug} (exit ${out.code}${out.timedOut ? ', TIMED OUT' : ''}${out.stdioHeld ? ', ORPHAN KILLED' : ''}, ${secs}s) =====`);
      if (out.tail.length >= TAIL_BYTES) {
        console.log(dim(`  [output over ${Math.round(TAIL_BYTES / 1024)}KB — tail only; full log: ${logPath}]`));
      }
      process.stdout.write(out.tail.endsWith('\n') ? out.tail : `${out.tail}\n`);
      if (out.timedOut) {
        console.log(crit(`  ${slug} exceeded ${Math.round(AREA_TIMEOUT_MS / 60000)}min and was killed — its results are PARTIAL, not clean (raise CW_SWEEP_AREA_TIMEOUT_MS if this is legitimate)`));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, slugs.length) }, worker));
  console.log(`\n${TAG} fleet summary`);
  for (const r of results.sort((a, b) => b.secs - a.secs)) {
    // A timeout (we stopped looking) is distinct from a non-zero exit (the area failed).
    const state = r.timedOut ? crit('TIMED OUT') : r.code === 0 ? live('exit 0') : crit(`exit ${r.code}`);
    console.log(`  ${mut(r.slug.padEnd(22))} ${state}  ${dim(`${r.secs}s`)}`);
  }
  const stalled = results.filter((r) => r.timedOut);
  if (stalled.length) {
    console.log(crit(`${TAG} ${stalled.length} area(s) were killed on the timeout — their slices are PARTIAL: ${stalled.map((r) => r.slug).join(', ')}`));
  }
  const orphaned = results.filter((r) => r.stdioHeld);
  if (orphaned.length) {
    console.log(crit(`${TAG} ${orphaned.length} area(s) left a process holding their output after exiting; it was killed and those slices are PARTIAL: ${orphaned.map((r) => r.slug).join(', ')}`));
  }
  // fleet-wide finalise, ONCE — each step's outcome is captured for the fleet verdict record.
  const finalize = {};
  for (const [label, argv] of [
    ['timeline', [join(HERE, 'timeline.mjs')]],
    ['runtime', [join(HERE, 'runtime-report.mjs')]],
    ['compact', [join(HERE, 'compact-reports.mjs'), '--apply']],
    ['projectstatus', [join(CW, 'bin', 'projectstatus.mjs')]],
  ]) {
    if (label === 'projectstatus' && process.env.CW_PROJECTSTATUS === '0') {
      console.log(`${TAG} projectstatus refresh skipped (CW_PROJECTSTATUS=0 — the tracked doc is left to scheduled/manual sweeps)`);
      finalize[label] = 'skipped';
      continue;
    }
    console.log(`${TAG} ${label}`);
    try { execFileSync('node', argv, { stdio: 'inherit' }); finalize[label] = 'ok'; }
    catch (e) { console.log(`${TAG} ${label} failed (non-fatal): ${e.message}`); finalize[label] = 'failed'; }
  }
  const failed = results.filter((r) => r.code !== 0);
  console.log(`${TAG} fleet done — ${results.length - failed.length}/${results.length} areas clean`);
  // One fleet-verdict line per run; child areas each write their own area verdict.
  {
    const rec = buildFleetVerdict({
      stamp, group, jobs, areas: results, finalize,
      clean: `${results.length - failed.length}/${results.length}`,
      exit: failed.length ? 1 : 0,
      startedAt: START_ISO, finishedAt: new Date().toISOString(),
    }, { root: CW });
    const w = appendRecord(join(logDir, 'sweep-fleet-journal.jsonl'), rec);
    if (!w.ok) console.error(`${TAG} fleet verdict journal write failed (${w.error}) — this run's verdict is not recorded`);
  }
  await exitFlushed(failed.length ? 1 : 0);
}


// Per-area batch dir — the area suffix makes the batch identity unique per scope. The old
// suffix-free form must keep resolving forever (existing batches are the re-rollup identity key).
const batchDir = join(CW, reg.reportsRoot, `sweep-${stamp}-${sweepAll ? 'all' : (scopeArea || 'all')}`);
mkdirSync(batchDir, { recursive: true });
console.log(`${TAG} ${bold(String(repos.length))} repos ${dim('·')} group=${bold(group)} ${dim('·')} ${dim(`-> ${batchDir}`)}`);

// Pull each scanner image ONCE, bounded, before the first repo — not `--pull=always` per repo, which
// cost 100 registry round-trips a batch and hung sweep-20260822153004 for 8.9 h on one stalled pull.
// Presence + digest go into batch-manifest so the batch can name the scanner build that produced it.
const readManifestFile = (n) => JSON.parse(readFileSync(join(CW, 'manifests', /\.json$/.test(n) ? n : `${n}.json`), 'utf8'));
const { images: imageList, problems: manifestProblems } = manifestImages(readManifestFile, repos.flatMap((r) => [].concat(r.manifest)));
for (const p of manifestProblems) console.error(`${TAG} manifest images unreadable — ${p}`);
const images = warmImages(imageList);
if (images.restart) {
  const ir = images.restart;
  console.log(`${TAG} docker was DOWN — restart ${ir.attempted
    ? `attempted (${ir.method}): ${ir.ok ? live(`recovered in ${ir.secs}s`) : crit('still down')}`
    : `not attempted (${ir.mode})`}${ir.reason ? ` ${mut(`— ${ir.reason}`)}` : ''}`);
}
if (images.docker === 'ok') {
  for (const [i, s] of Object.entries(images.images)) {
    console.log(`${TAG} image ${i}: ${s.pulled ? live('pulled') : crit('NOT pulled')}${s.digest ? dim(` ${s.digest.split('@')[1].slice(0, 19)}`) : ''}${s.reason ? ` ${mut(`— ${s.reason}`)}` : ''} ${dim(`(${s.secs}s)`)}`);
  }
} else console.log(`${TAG} images: ${mut(images.reason)}`);

// batch-manifest.json — code anchors + intended scope, written BEFORE running so the rollup
// can distinguish "intended but never ran" (tool provenance decides) from "out of scope".
// Anchors are best-effort: non-git paths anchor as {sha:null}.
function gitAnchor(path) {
  // scannedGit: `status` refreshes a fleet repo's index on the host, which runs its core.fsmonitor
  const git = (args) => { const r = scannedGit(path, args); return !r.error && r.status === 0 ? String(r.stdout).trim() : null; };
  const sha = git(['rev-parse', 'HEAD']);
  if (sha === null) return { sha: null, branch: null, dirty: null };
  const porcelain = git(['status', '--porcelain']);
  return { sha, branch: git(['rev-parse', '--abbrev-ref', 'HEAD']), dirty: porcelain === null ? null : porcelain.split('\n').filter(Boolean).length };
}
const anchors = {};
for (const r of repos) if (existsSync(r.path)) anchors[r.name] = { path: r.path, ...gitAnchor(r.path) };
// rollback-standby (superseded) trees keep an anchor too — the sha a rollback would restore
for (const [n, lc] of Object.entries(superseded)) if (lc.path && existsSync(lc.path)) anchors[n] = { path: lc.path, ...gitAnchor(lc.path), lifecycle: 'superseded' };
writeFileSync(join(batchDir, 'batch-manifest.json'), JSON.stringify({
  sliceId: `sweep-${stamp}`, kind: 'sweep', group, only: only || null,
  area: scopeArea, areaOut: OUT_DIR.replace(CW + '/', ''), sweptAll: sweepAll,
  startedAt: new Date().toISOString(),
  // the runner's own anchor at sweep START; each repo's toolchain.json records what actually ran it,
  // and the rollup's vintage.code counts how many runners a batch ended up with
  toolchain: gitAnchor(CW),
  // scanner images: pulled once above; {presentBefore, pulled, digest, reason} per image, or null + reason
  images,
  scope: { repos: repos.map((r) => ({ name: r.name, manifests: [].concat(r.manifest) })), excluded: [...EXCLUDE],
    // run-scoped area skips, kept separate from `excluded` so a partial sweep cannot read as complete
    excludedAreas: [...excludedAreas],
    lifecycle: Object.fromEntries(Object.entries(superseded).map(([n, lc]) => [n, { state: lc.state, supersededBy: lc.supersededBy || '', effectiveFrom: lc.effectiveFrom || '', note: lc.note || '' }])) },
  anchors,
}, null, 2));

// ── HOST INVENTORY: who owns each port, observed while the scan runs ─────────────────────────
// Captured twice (before/after); disagreeing ports resolve to `unknown`. Always wrapped — an
// inventory failure must never abort a sweep.
let hostInvBefore = null;
try {
  hostInvBefore = hostInventory();
  if (!hostInvBefore.ok) console.log(`${TAG} host-inventory: ${mut(hostInvBefore.reason)}`);
} catch (e) {
  console.log(`${TAG} host-inventory: ${mut(`capture failed (${e && e.message ? e.message.split('\n')[0] : e}) — ownership will read UNKNOWN, never clean`)}`);
}

// ── START MARKER: the deadman for "a sweep that never finished" ─────────────────────────────
// Declared in flight before scanning; cleared only after the rollup published (or deliberately
// refused an empty batch). A crash/hang leaves the marker standing and liveness.mjs alarms.
const INFLIGHT = join(OUT_DIR, '.sweep-inflight.json');
mkdirSync(OUT_DIR, { recursive: true });
{
  const tmp = `${INFLIGHT}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify({
    sliceId: `sweep-${stamp}`, area: scopeArea, group,
    startedAt: new Date().toISOString(), pid: process.pid, batch: batchDir.replace(CW + '/', ''),
  }, null, 2));
  renameSync(tmp, INFLIGHT);
}

// ── REAP: containers a DEAD slice left running ──────────────────────────────────────────────
// A lane killed at its timeout leaves `docker run`'s container alive on the daemon — the client
// died, the container did not — still holding the source mount and able to write into a batch
// this sweep has already finalised. Removed here, before the first repo. "Not mine" is NOT
// "orphan": several areas sweep concurrently, so every slice whose inflight marker names a LIVE
// pid is spared; only containers belonging to no live sweep are removed.
{
  const liveSlices = [`sweep-${stamp}`];
  try {
    const root = join(CW, reg.reportsRoot || 'reports');
    for (const d of readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      let mk; try { mk = JSON.parse(readFileSync(join(root, d.name, '.sweep-inflight.json'), 'utf8')); }
      catch { continue; }
      if (!mk || !mk.sliceId || !mk.pid) continue;
      try { process.kill(mk.pid, 0); if (processState(mk.pid) !== 'Z') liveSlices.push(mk.sliceId); } catch { /* dead pid: its containers are orphans */ }
    }
  } catch (e) {
    // Fail CLOSED: an unreadable reports root means the live set is unknown, and reaping against
    // an unknown live set could kill a peer sweep's running scan. Skip the reap and say so.
    console.log(`${TAG} reap: skipped — could not enumerate inflight markers (${(e && e.code) || e}); leftover containers, if any, are left alone`);
    liveSlices.push(null);
  }
  if (!liveSlices.includes(null)) {
    const reap = reapOrphans(liveSlices);
    if (reap.orphans.length) console.log(`${TAG} reap: removed ${bold(String(reap.killed.length))} container(s) from dead slices${reap.failed.length ? crit(` · ${reap.failed.length} refused`) : ''} ${dim(reap.orphans.join(', ').slice(0, 120))}`);
    if (reap.spared.length) console.log(`${TAG} reap: spared ${reap.spared.length} container(s) whose owning process is alive ${dim(reap.spared.join(', ').slice(0, 120))}`);
    if (reap.undetermined.length) console.log(`${TAG} reap: left ${reap.undetermined.length} container(s) alone: their owner's liveness could not be checked ${dim(reap.undetermined.join(', ').slice(0, 120))}`);
  }
}

// ── VERDICT CAPTURE ─────────────────────────────────────────────────────────────────────────
// Step outcomes land here as steps run; a slot never assigned renders 'unknown', never omitted.
const verdictParts = { steps: {} };

// ── SCAN, optionally in parallel (--jobs N) ─────────────────────────────────────────────────
// Serial by default (scanners are themselves multi-core; N processes oversubscribe). Parallel
// mode captures each child's output and replays it in completion order; serial keeps `inherit`.
const JOBS = (() => {
  const i = process.argv.indexOf('--jobs');
  if (i < 0) return 1;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`${TAG} --jobs needs a positive integer, got ${JSON.stringify(process.argv[i + 1])}`);
    process.exit(2);
  }
  return n;
})();

// ── ADJUDICATE, in the batch, beside the artifact it judges ──────────────────────────────────
// Runs here and persists (not at render time) so the verdict records which template version
// produced it. Never fatal: no template store means "not judged", not "judged clean".
const solveTotals = { dirs: 0, records: 0, refuted: 0, hostless: 0, unconserved: 0, uncited: 0 };
function solveOne(reportDir, name) {
  try {
    const s = solveNuclei(reportDir);
    if (!s.ok) return;                       // no nuclei artifact here — nothing judged, nothing claimed
    writeSolved(reportDir, s);
    solveTotals.dirs++;
    solveTotals.records += s.total;
    solveTotals.refuted += s.counts.refuted;
    if (!s.conserved) solveTotals.unconserved++;
    solveTotals.uncited += s.uncited.length;
    // Invariant breaches print per-repo, not only in the summary.
    if (!s.conserved) console.log(`${TAG} ${crit('solve ' + name + ': CONSERVATION FAILED')} — ${s.total} record(s) in, ${s.records.length + s.counts.unparseable} accounted for`);
    if (s.uncited.length) console.log(`${TAG} ${crit('solve ' + name + ': ' + s.uncited.length + ' refutation(s) with no rule citation')}`);
  } catch (e) {
    console.log(`${TAG} solve ${name}: ${mut(`failed (${e && e.message ? e.message.split('\n')[0] : e}) — findings stay UNJUDGED, which is not the same as correct`)}`);
  }
}

// C2: per-area minifiedCode thresholds -> CW_MINIFY_* env. Spread before process.env so an
// explicit operator override still wins.
const areaMinifyEnv = (() => {
  const a = scopeArea ? areaBySlug(scopeArea, reg) : null;
  const m = a && a.minify;
  if (!m) return {};
  const e = {};
  if (m.maxBytes != null) e.CW_MINIFY_MAX_BYTES = String(m.maxBytes);
  if (m.semgrepCeiling != null) e.CW_MINIFY_SEMGREP_CEILING = String(m.semgrepCeiling);
  if (m.entropyRule != null) e.CW_MINIFY_ENTROPY_RULE = m.entropyRule ? '1' : '0';
  return e;
})();

// SEMGREP PRO IS ALLOCATED PER REPOSITORY, NOT FIXED BY THE MANIFEST. The Pro engine is licensed
// for a bounded number of repos and the fleet is larger than that bound, so `sast` cannot simply
// carry --pro-intrafile for everyone. Repos outside the allocation run the OSS engine and publish
// REAL findings: a narrower engine is a coverage bound, recorded as one, and never a reason to
// withhold a number or to publish an undetermined as a finding.
//
// The registry wins over the ambient environment, which is why this is spread AFTER ...process.env
// and why an unallocated repo is set to '' rather than left absent. An exported CW_SEMGREP_PRO=1
// must not be able to buy a licence seat the registry did not grant — a cap that any shell can
// step around is a decoration. Empty is also the fail-closed direction: `${VAR:+flag}` treats
// empty and unset alike, so anything this code fails to decide runs OSS.
const SEMGREP_PRO = new Set((reg.semgrepPro && reg.semgrepPro.repos) || []);

function scanOne(r) {
  const reportDir = join(batchDir, r.name);
  mkdirSync(reportDir, { recursive: true });
  // CW_SLICE/CW_REPO_SLUG name every container this repo's lanes start (cw-<slice>-<repo>-<check>),
  // so a timed-out lane can remove its own containers and a later sweep can reap what it left.
  const env = { ...areaMinifyEnv, ...process.env, CW_REPORT_DIR: reportDir, CW_SKIP_SETUP: '1',
    CW_SLICE: `sweep-${stamp}`, CW_REPO_SLUG: r.name, ...(r.url ? { CW_TARGET_URL: r.url } : {}),
    CW_SEMGREP_PRO: SEMGREP_PRO.has(r.name) ? '1' : '' };
  const args = (manifest) => [join(CW, 'bin/commitwork.mjs'), 'run', group,
    '--manifest', manifest, '--repo', r.path, '--no-fail-fast'];
  // a project may declare multiple manifests (e.g. security-baseline + build-health);
  // run each into the same report dir so the rollup sees all their reports together.
  // K7: the exit is RECORDED per manifest, not swallowed. commitwork exits 1 on findings, which is a
  // scan that ran; 2 is a refusal before scanning and a signal is a kill — those never ran, and
  // until now the catch below made all three look alike. scanOutcome() decides; the sweep's own
  // exit carries the ones that did not run (sweepExit()).
  const manifestName = (m) => String(m).split('/').pop();
  if (JOBS === 1) {
    for (const manifest of [].concat(r.manifest)) {
      try { execFileSync('node', args(manifest), { stdio: 'inherit', env }); scanOutcomes.push(scanOutcome({ name: r.name, manifest: manifestName(manifest), code: 0 })); }
      catch (e) { scanOutcomes.push(scanOutcome({ name: r.name, manifest: manifestName(manifest), code: e.status ?? null, signal: e.signal ?? null, error: e.status == null && !e.signal ? e.message : null })); }
    }
    solveOne(reportDir, r.name);
    return Promise.resolve('');
  }
  // parallel: run this repo's manifests in sequence (they share one reportDir), capture output
  return (async () => {
    let out = '';
    for (const manifest of [].concat(r.manifest)) {
      out += await new Promise((res) => {
        execFile('node', args(manifest), { env, maxBuffer: 64 * 1024 * 1024 },
          (e, stdout, stderr) => {
            scanOutcomes.push(scanOutcome({ name: r.name, manifest: manifestName(manifest), code: e ? (e.code ?? null) : 0, signal: e?.signal ?? null, error: e && e.code == null && !e.signal ? e.message : null }));
            res(String(stdout || '') + String(stderr || ''));
          });
      });
    }
    solveOne(reportDir, r.name);
    return out;
  })();
}
const scanOutcomes = [];

// ── SCANNER PREFLIGHT — refresh the vulnerability data BEFORE the pass, not after ────────────
// A scanner is only as current as the database behind it, and a stale database returns zero for
// everything disclosed since it last synced — a zero indistinguishable from a real one. Running the
// refresh here means each sweep is made against current data rather than whatever happened to be on
// disk when the box was last used interactively.
//
// It also REPORTS any scanner that cannot state its own version — Homebrew's govulncheck reported
// `govulncheck@v0.0.0`, because its formula builds from a source tarball with no VCS or module
// information for Go to stamp. The ground for refusing that is an UNFALSIFIABLE ZERO and nothing
// more: if the tool cannot say which build produced a result, nobody can say which advisories the
// result was checked against. An earlier version of this comment also called the unstamped build
// functionally broken on a specific repo; that measurement did not reproduce and has been retracted
// in bin/scanner-preflight.mjs, where the reasoning now lives in full.
//
// IT WARNS, IT DOES NOT ABORT, and that is a deliberate asymmetry. Refusing to sweep because one
// lane's binary is unstamped would trade a partial scan for NO scan, and a fleet that stops
// scanning is worse off than one scanning with a named, visible gap. The gap is printed here and
// the affected lane still reports its own noscan downstream.
// CW_SWEEP_NO_PREFLIGHT=1 skips it, matching the other finalise-step switches.
if (process.env.CW_SWEEP_NO_PREFLIGHT === '1') {
  console.log(`${TAG} scanner preflight skipped (CW_SWEEP_NO_PREFLIGHT=1 — this pass runs against whatever data is on disk)`);
} else {
  try {
    const pf = spawnSync('node', [join(CW, 'bin/scanner-preflight.mjs'), '--update'],
      { encoding: 'utf8', timeout: 20 * 60 * 1000, env: childEnv });
    const out = `${pf.stdout || ''}${pf.stderr || ''}`.trim();
    if (pf.status === 0) console.log(`${TAG} scanner preflight: all scanners identify themselves; databases refreshed`);
    else {
      console.log(crit(`${TAG} scanner preflight: one or more scanners cannot state a version — their zeros are unfalsifiable`));
      for (const line of out.split('\n').filter((l) => /REFUSED|✖/.test(l)).slice(0, 6)) console.log(`  ${line.trim()}`);
      console.log(dim('  sweeping anyway — a named gap beats no scan; the affected lanes report their own noscan'));
    }
  } catch (e) {
    // The preflight failing is not a reason to skip the sweep, but it IS a reason to say the data
    // may be stale — silence here would let an unrefreshed pass look like a refreshed one.
    console.log(crit(`${TAG} scanner preflight did not run (${e.message.slice(0, 80)}) — vulnerability data may be stale`));
  }
}

// ── ADMISSION CONTROL ────────────────────────────────────────────────────────────────────────
// Take one of a bounded number of concurrent sweep permits before scanning anything. On 2026-08-21
// eleven sweeps ran at once — load 87, 1GB free of 48, per-repo throughput down from 2.6 to 30
// minutes. Every one of them "succeeded"; they just measured a contended box and took all morning.
// The cost of that contention is the whole argument: memory-layer measured 335 minutes during the pile-up
// and **5 minutes** re-run on a quiet box, same manifest, same 22 checks, 423 findings. The bound
// is not rationing scarce capacity — the fleet fits in under three hours sequentially — it is
// preventing a stampede that multiplied its own cost by ~67.
//
// A REFUSED SWEEP DOES NOT RUN, and that is the point rather than a regret. The area's rollup is
// left untouched, so its freshness goes stale and the deadman says so — which is TRUE, it was not
// swept. That is strictly better than the state this replaces, where every area ran, all of them
// degraded, and produced contended numbers indistinguishable from quiet-box ones.
// CW_SWEEP_SLOTS tunes the bound; CW_SWEEP_SLOTS=0 disables admission control entirely.
//
// THE TUNING PANEL NOW REACHES THIS NUMBER. Until 2026-08-26 the bound was a constant: the panel
// resolved a hardware profile plus depth and intensity into a recommended slot count, wrote it to
// the settings store, and NOTHING read it — while settings.mjs's own SETTING_KEYS declared
// `consumers: ['monitor/sweep.mjs']` on scanDepth and scanIntensity, a claim this file did not
// honour and nothing checked. A control that is built, tested and fed by nothing is worse than an
// absent one, because the operator believes the knob is connected.
//
// PRECEDENCE, matching monitor/settings.mjs exactly: env > store > derived > declared default.
// An explicit CW_SWEEP_SLOTS still wins outright, so nothing that set it changes behaviour.
//
// FAILS OPEN, LOUDLY. The tuning model throws when its profile document is unreadable — correct
// there, wrong here, because a sweep that cannot resolve a recommendation must still sweep. On any
// failure the constant is used AND the reason is printed, so a run whose tuning was ignored is
// never mistaken for one whose tuning was applied.
function derivedSlots() {
  if (process.env.CW_SWEEP_SLOTS !== undefined) {
    return { n: Number(process.env.CW_SWEEP_SLOTS), source: 'env CW_SWEEP_SLOTS' };
  }
  try {
    const depth = getSetting('scanDepth');
    const intensity = getSetting('scanIntensity');
    const profile = getSetting('perfProfile');
    const t = resolveTuning({
      profileId: profile.value || 'auto',
      depth: depth.value,
      intensity: intensity.value,
    });
    if (!Number.isFinite(t.slots) || t.slots < 1) {
      return { n: DEFAULT_SLOTS, source: `default (tuning returned no usable slot count)` };
    }
    return {
      n: t.slots,
      source: `tuning — profile ${t.profile?.id || '?'}, depth ${depth.value} (${depth.source}), intensity ${intensity.value} (${intensity.source})`,
      warnings: t.warnings || [],
    };
  } catch (e) {
    return { n: DEFAULT_SLOTS, source: `default — tuning unavailable (${e.message})`, failed: true };
  }
}
const slotChoice = derivedSlots();
const SLOT_N = slotChoice.n;
if (slotChoice.failed) console.log(crit(`${TAG} scanner tuning NOT applied: ${slotChoice.source}`));
let slotHeld = null;
if (SLOT_N > 0) {
  // The permits live at the REPORTS ROOT, not in an area's out dir: the bound is fleet-wide, and a
  // per-area file would let 32 areas each hold their own "one" slot and change nothing.
  const got = acquireSweepSlot(join(CW, reg.reportsRoot || 'reports'), {
    slots: SLOT_N, label: `sweep:${scopeArea || 'all'}`,
    sleep: (ms) => { try { execFileSync('sleep', [String(Math.ceil(ms / 1000))]); } catch { /* interrupted is fine */ } },
    onWait: (n) => console.log(`${TAG} all ${n} sweep slots busy — waiting for a turn (CW_SWEEP_SLOTS=0 disables)`),
  });
  if (got.ok !== true) {
    console.log(crit(`${TAG} DEFERRED — ${got.reason}. This area was NOT swept; its freshness will go stale, which is`));
    console.log(crit(`${TAG} the honest reading. This should be RARE: a quiet-box sweep of a small area takes ~5 minutes,`));
    console.log(crit(`${TAG} so ${SLOT_N} permits is ample for the fleet. A deferral means something genuinely overran —`));
    console.log(crit(`${TAG} look at what is holding a slot rather than raising CW_SWEEP_SLOTS to make this go away.`));
    process.exit(0); // not a failure: a deferral is a scheduling outcome, and a red here would train the operator to ignore it
  }
  slotHeld = got;
  console.log(`${TAG} admitted on slot ${got.slot}/${SLOT_N}${got.waitedMs > 1000 ? ` after ${Math.round(got.waitedMs / 1000)}s wait` : ''}`);
}

let scanned = 0;
const present = repos.filter((r) => {
  if (existsSync(r.path)) return true;
  console.log(`  skip ${r.name} (missing)`);
  return false;
});

if (JOBS === 1) {
  for (const r of present) {
    // progress marker consumed by the admin panel's live sweep console (admin/serve.mjs parses
    // "(i/N) scan <name>"); also human-readable when the sweep is run from a terminal.
    console.log(`${TAG} ${dim(`(${++scanned}/${present.length})`)} scan ${bold(r.name)}`);
    await scanOne(r);
  }
} else {
  console.log(`${TAG} scanning ${present.length} repos with --jobs ${JOBS} (output is captured and replayed per repo)`);
  const queue = [...present];
  const worker = async () => {
    for (;;) {
      const r = queue.shift();
      if (!r) return;
      const out = await scanOne(r);
      // The progress line is emitted on COMPLETION, not on start: with N workers a start-ordered
      // "(i/N)" would jump around and the panel's parser would read a count that never settles.
      console.log(`${TAG} ${dim(`(${++scanned}/${present.length})`)} scan ${bold(r.name)}`);
      if (out) process.stdout.write(out.endsWith('\n') ? out : out + '\n');
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, present.length) }, worker));
}

// ONE line for the scans that did not run — per-item rows live in the verdict record, not here
// (per-item alarms are how a gate becomes wallpaper, A4). The exit code at the end carries them.
{
  const notRan = scanOutcomes.filter((s) => !s.ran);
  if (notRan.length) console.log(`${TAG} ${crit(`${notRan.length} of ${scanOutcomes.length} scan(s) did NOT run`)} — ${notRan.map((s) => `${s.name} (${s.manifest}): ${s.why}`).join('; ')}`);
  else console.log(`${TAG} ${scanOutcomes.length} scan(s) ran (${scanOutcomes.filter((s) => s.code === 1).length} with findings)`);
}

// One line for the adjudication lane, so a sweep states what it judged rather than leaving it to
// be discovered. Zero dirs with a non-zero fleet is the shape of an absent template store, and it
// says so instead of reading as "nothing to refute".
if (solveTotals.dirs || solveTotals.records) {
  console.log(`${TAG} solve: ${bold(String(solveTotals.records))} nuclei record(s) across ${solveTotals.dirs} repo(s) ${dim('·')} ` +
    `${solveTotals.refuted} refuted` +
    (solveTotals.unconserved ? ` ${crit(`· ${solveTotals.unconserved} dir(s) FAILED CONSERVATION`)}` : '') +
    (solveTotals.uncited ? ` ${crit(`· ${solveTotals.uncited} uncited refutation(s)`)}` : ''));
} else {
  console.log(`${TAG} solve: ${mut('nothing adjudicated — no nuclei artifacts, or no local template store to derive rules from')}`);
}

// ── HOST INVENTORY, second look — closes the observation window over the scanning ────────────
// Two files land in the batch. `host-inventory.local.json` carries the process detail (command,
// pid, user) that makes a verdict auditable on the box; `host-inventory.json` is the redacted
// shape the panel may serve, because the panel goes over a tunnel and those fields describe the
// operator's own machine, not fleet posture. Both are best-effort and neither can fail a sweep.
try {
  const after = hostInventory({ windowStart: hostInvBefore?.window?.capturedAt || null });
  const inv = hostInvBefore ? reconcileHostInventory(hostInvBefore, after) : after;
  if (inv && inv.ok) {
    writeHostInventory(batchDir, inv, { published: false });
    writeHostInventory(batchDir, inv, { published: true });
    const unstable = inv.counts.unstable ? `, ${inv.counts.unstable} changed hands mid-batch (-> unknown)` : '';
    console.log(`${TAG} host-inventory: ${bold(String(inv.counts.total))} ports ${dim('·')} ` +
      `${inv.counts.project} project, ${inv.counts.host} host${unstable}` +
      `${inv.privileged ? '' : dim(' · unprivileged: an unseen port means NOT SEEN, never not bound')}`);
    verdictParts.hostInventory = 'ok';
  } else if (inv) {
    console.log(`${TAG} host-inventory: ${mut(inv.reason)}`);
    verdictParts.hostInventory = 'degraded';
  }
} catch (e) {
  console.log(`${TAG} host-inventory: ${mut(`capture failed (${e && e.message ? e.message.split('\n')[0] : e}) — ownership will read UNKNOWN, never clean`)}`);
  verdictParts.hostInventory = 'failed';
}

// roll the batch up into rollup.json + dashboard.html + REMEDIATION.md + history/LOG.md
console.log(`${TAG} rollup`); // phase marker for the live console (post-scan aggregation)
// D8: guarded — an empty batch is not fatal; downstream best-effort steps still run.
let rollupPublished = false;
// nothingToRollUp: rollup exited 4 (no repo report directory) — exit map in sweep-verdict.mjs's
// rollupOutcome. Rollup-dependent steps below are skipped in that case.
let nothingToRollUp = false;
try {
  execFileSync('node', [join(HERE, 'rollup.mjs'), batchDir], { stdio: 'inherit', env: childEnv });
  rollupPublished = true;
  verdictParts.rollup = rollupOutcome(0);
} catch (e) {
  verdictParts.rollup = rollupOutcome(e.status ?? 1);
  if (e.status === 4) { console.log(`${TAG} nothing to roll up (no repo report directory) — skipping the rollup-dependent steps.`); rollupPublished = true; nothingToRollUp = true; }
  else if (e.status === 2) { console.error(`${TAG} rollup wrote nothing (empty batch — no tool output). Continuing.`); rollupPublished = true; }
  // 3 is lock contention and deliberately falls through — the other holder is publishing.
  else console.error(`${TAG} rollup failed (exit ${e.status ?? '?'}) — continuing with best-effort steps.`);
}
// Clear the start marker only when the rollup published; a crash leaves it for liveness to alarm.
if (rollupPublished) {
  try { rmSync(INFLIGHT, { force: true }); verdictParts.inflightCleared = true; }
  catch (e) { verdictParts.inflightCleared = false; console.error(`${TAG} could not clear ${INFLIGHT.replace(CW + '/', '')} (${e.code || e.message}) — liveness will alarm on it, which is the safe direction.`); }
} else {
  verdictParts.inflightCleared = false;
  console.error(`${TAG} leaving ${INFLIGHT.replace(CW + '/', '')} in place — the rollup did not publish, and liveness will alarm on it.`);
}

// codeql-fleet.json — the structured file the panel reads for CodeQL numbers. Per-area,
// best-effort; a sweep that ran no CodeQL keeps the last real snapshot instead of erasing it.
console.log(`${TAG} codeql-fleet`);
try { execFileSync('node', [join(HERE, 'codeql-fleet-data.mjs')], { stdio: 'inherit', env: childEnv }); verdictParts.steps.codeqlFleet = 'ok'; }
catch (e) { console.error(`${TAG} codeql-fleet-data failed (non-fatal): ${e.message}`); verdictParts.steps.codeqlFleet = 'failed'; }

// envelope witness: the live corpus replay the STPA ++ADVERSARIAL row and the agentic policy gate
// wait on. Opt-in (CW_LIVE_LLM=1) and self-paced by the witness's own 7-day freshness window, so a
// sweep pays for a model call at most once per window; 3 is its skip code, anything else non-zero
// is a failed or failing replay and is carried into the exit like every other step.
console.log(`${TAG} envelope-witness`);
{
  const r = spawnSync('node', [join(HERE, 'envelope-witness.mjs')], { stdio: 'inherit', env: childEnv });
  verdictParts.steps.envelopeWitness = r.status === 0 ? 'ok' : r.status === 3 ? 'skipped' : 'failed';
}

// liveness heartbeat: freshness deadman against the rollup just written. Best-effort here —
// a stale verdict prints but never blocks the sweep.
console.log(`${TAG} liveness`);
// Skipped when there was nothing to roll up: OUT_DIR/rollup.json does not exist then.
if (!nothingToRollUp) {
  try {
    const rollupJson = join(OUT_DIR, 'rollup.json');
    execFileSync('node', [join(HERE, 'liveness.mjs'), rollupJson], { stdio: 'inherit', env: childEnv });
    verdictParts.steps.liveness = 'ok';
  } catch { verdictParts.steps.liveness = 'nonzero'; /* a non-fresh verdict exits non-zero — surfaced on stderr by liveness, never blocks the sweep */ }
} else {
  verdictParts.steps.liveness = 'skipped';
}

// ── preflight: is a scan of these repos going to MEAN anything? ─────────────────────────────
// Read-only; writes the verdict beside the rollup so `blind` survives as its own state.
// Never builds anything here — that stays an explicit `preflight-build.mjs --apply`.
try {
  const { preflight } = await import('./preflight-build.mjs');
  const { writeAtomic } = await import('./lockfile.mjs');
  const pf = preflight(repos, { apply: false });
  // Atomic: the only reader (timeline.mjs) refuses a torn read rather than degrading.
  writeAtomic(join(OUT_DIR, 'preflight.json'), `${JSON.stringify(pf, null, 2)}\n`);
  const t = pf.tally;
  verdictParts.preflight = { ...t };
  console.log(`${TAG} preflight: ${bold(String(t.ok))} scannable · ${t.blind ? crit(`${t.blind} BLIND`) : '0 blind'}`
    + ` · ${t['subtree-only'] || 0} subtree-only · ${t['no-surface']} no dependency surface · ${t.missing} not on disk`);
  if (t.blind) {
    console.log(`${TAG} ${part('BLIND is not clean')} — ${pf.repos.filter((r) => r.state === 'blind').map((r) => r.name).join(', ')}`);
    console.log(`${TAG} ${mut('build them with: node monitor/preflight-build.mjs --apply')}`);
  }
} catch (e) {
  // Never blocks a sweep; absence is stated, never passed off as "nothing blind".
  console.error(`${TAG} preflight failed (non-fatal; blindness is UNKNOWN this slice, not zero): ${e.message}`);
  verdictParts.preflight = 'failed';
}

// ── issue tracker ingest ────────────────────────────────────────────────────────────────────
// In-process (withIssuesLock serialises --all children); safe by construction — ingestArea
// refuses stale/not-newer/not-ran categories. Per-area; skipped when nothing rolled up.
if (scopeArea && !nothingToRollUp) {
  console.log(`${TAG} issues`);
  try {
    const { loadIssues, saveIssues, withIssuesLock, identityProblems, gcIssues, nowISO } = await import('./issue-store.mjs');
    const { ingestArea } = await import('./issue-ingest.mjs');
    const rollupJson = JSON.parse(readFileSync(join(OUT_DIR, 'rollup.json'), 'utf8'));
    let ledger = null;
    try { ledger = JSON.parse(readFileSync(join(OUT_DIR, 'remediation-ledger.json'), 'utf8')); }
    catch { /* no ledger yet — dep closes simply have no evidence to close on */ }
    let annotations = [];
    // BOTH arrays, from the one file. `annotations` are dependency waivers; `scannerAnnotations`
    // are scanner-row adjudications and are what the panel's Mark-FP writes. Only the first was
    // ever read here, so a person dismissing a scanner finding suppressed the rollup row and the
    // issue stayed open — measured 2026-08-26 at 14 of 600 open scanner issues, including the
    // planted canary credentials in bin/secrets-canary.mjs.
    let scannerAnnotations = [];
    try {
      const doc = JSON.parse(readFileSync(annotationsPathFor(CW), 'utf8'));
      annotations = doc.annotations || [];
      scannerAnnotations = doc.scannerAnnotations || [];
    } catch (e) {
      // Absent means nothing is suppressed. Unreadable is not absent: ingesting with no suppressions
      // would reopen every dismissed row, so the ingest fails loudly below instead.
      if (!e || e.code !== 'ENOENT') throw new Error(`annotations store unreadable (${annotationsPathFor(CW)}): ${e && e.message}`);
    }
    // Repo paths from THIS sweep's resolved list — anchors read from the tree actually scanned.
    const repoPaths = {};
    for (const r of repos) if (r.path) repoPaths[r.name] = r.path;
    // R2 baseline: grandfather pre-existing minifiedCode findings; empty until an operator captures.
    let baselinePlaceKeys = null;
    try { const mb = await import('./minify-baseline.mjs'); baselinePlaceKeys = mb.loadBaselinePlaceKeys(); }
    catch { baselinePlaceKeys = null; }
    const summary = withIssuesLock(() => {
      const doc = loadIssues();
      // Reap before ingest, inside the same lock and save — a refused ingest discards the reap.
      const reaped = gcIssues(doc, { at: nowISO() });
      // Refuse to save a store this ingest just broke: pre-existing problems don't block,
      // regressions never reach disk.
      const before = identityProblems(doc).length;
      const s = ingestArea(doc, { areaSlug: scopeArea, rollup: rollupJson, ledger, annotations, scannerAnnotations, repoPaths, now: nowISO(), baselinePlaceKeys });
      const after = identityProblems(doc).length;
      s.identityProblems = { before, after };
      // The reap is claimed only when it reached disk; null is "not applied", never 0.
      s.reaped = null;
      if (s.status === 'ok') {
        if (after > before) { s.status = 'refused-identity-regression'; return s; }  // nothing saved
        saveIssues(doc);
        s.reaped = { claims: reaped.expiredClaims.length, waivers: reaped.expiredWaivers.length };
      }
      return s;
    });
    // The status prints whatever it is — a silent no-op is how the frozen tracker went unnoticed.
    const skipped = (summary.skippedCategories || []).length;
    console.log(`${TAG} issues ${summary.status}: +${summary.created?.length ?? 0} new · `
      + `${summary.reopened?.length ?? 0} reopened · ${summary.closed?.length ?? 0} auto-closed · `
      + `${summary.suspect?.length ?? 0} suspect · ${summary.carried ?? 0} carried`
      + (summary.reaped
        ? ` · reaped ${summary.reaped.claims} expired claim(s), ${summary.reaped.waivers} expired waiver(s)`
        : ' · reap not applied (nothing saved)')
      + (skipped ? ` · ${skipped} categor${skipped === 1 ? 'y' : 'ies'} proved nothing (${
        Object.entries(summary.skippedReasons || {}).map(([c, why]) => `${c}:${why}`).join(', ')})` : ''));
    verdictParts.issues = {
      status: summary.status, created: summary.created?.length ?? 0, reopened: summary.reopened?.length ?? 0,
      closed: summary.closed?.length ?? 0, suspect: summary.suspect?.length ?? 0, carried: summary.carried ?? 0,
      reaped: summary.reaped,  // null = the gc ran but was discarded with a refused ingest; never 0
      skippedCategories: skipped,
    };
  } catch (e) {
    // Never blocks the sweep, but says so loudly rather than passing for a clean run.
    console.error(`${TAG} issue ingest failed (non-fatal, the tracker is now BEHIND this slice): ${e.message}`);
    verdictParts.issues = 'failed';
  }
} else {
  verdictParts.issues = 'skipped';
}

// Rebuild even when no new outcome arrived: weight decays against the sweep clock, not only events.
if (process.env.CW_SWEEP_NO_LEARNING === '1') {
  console.log(`${TAG} learning skipped (CW_SWEEP_NO_LEARNING=1)`);
  verdictParts.learning = 'skipped';
} else {
  try {
    const [{ loadIssues, verifyChain, nowISO }, { refreshLearningView }] = await Promise.all([
      import('./issue-store.mjs'), import('./learning-refresh.mjs'),
    ]);
    const issuesDoc = loadIssues();
    const problems = verifyChain(issuesDoc);
    if (problems.length) throw new Error(`issue-store chain invalid: ${problems[0]}`);
    const learning = refreshLearningView(issuesDoc, { now: nowISO() });
    if (!learning.ok) throw new Error(learning.error);
    console.log(`${TAG} learning ${learning.state}: ${learning.patterns} pattern(s)`);
    verdictParts.learning = learning;
  } catch (e) {
    console.error(`${TAG} learning failed (non-fatal, the learning view is STALE): ${e.message}`);
    verdictParts.learning = 'failed';
  }
}

// ── POST-ROLLUP EVIDENCE PASS: artifact-anomaly, verdict-journal anchors, remediation-outcome ──
// Evidence-only, per-batch (not hoisted behind CW_SWEEP_CHILD), each wrapped and never fatal,
// each individually CW-env skippable.
//
// artifact-anomaly: byte-identical-husk detector — module call, read-only, safe to repeat.
if (process.env.CW_SWEEP_NO_ANOMALY === '1') {
  console.log(`${TAG} artifact-anomaly skipped (CW_SWEEP_NO_ANOMALY=1)`);
  verdictParts.artifactAnomaly = 'skipped';
} else {
  console.log(`${TAG} artifact-anomaly`);
  try {
    const { artifactRoster, collectSamples, findAnomalies, writeAnomalies, anomaliesPath } = await import('./artifact-anomaly.mjs');
    const anomalyReportsDir = process.env.CW_ANOMALY_REPORTS_DIR || join(CW, reg.reportsRoot || 'reports');
    const minRepos = process.env.CW_ANOMALY_MIN_REPOS ? Number(process.env.CW_ANOMALY_MIN_REPOS) : undefined;
    const repoCap = process.env.CW_ANOMALY_REPO_CAP ? Number(process.env.CW_ANOMALY_REPO_CAP) : undefined;
    const samples = collectSamples(anomalyReportsDir, artifactRoster());
    const anomalies = findAnomalies(samples, { minRepos, repoCap });
    const outPath = anomaliesPath(anomalyReportsDir);
    writeAnomalies(outPath, anomalies);
    if (anomalies.length) {
      console.log(`${TAG} ${crit(`${anomalies.length} husk anomal${anomalies.length === 1 ? 'y' : 'ies'}`)} — see ${outPath.replace(`${CW}/`, '')}`);
      for (const a of anomalies) console.log(`${TAG}   ${a.category} ${a.hash.slice(0, 12)}… ${a.repoCount} repos, ${a.bytes} bytes each`);
    } else {
      console.log(`${TAG} artifact-anomaly: no byte-identical zero-finding groups found`);
    }
    verdictParts.artifactAnomaly = { ok: true, anomalies: anomalies.length };
  } catch (e) {
    console.error(`${TAG} artifact-anomaly failed (non-fatal): ${e.message}`);
    verdictParts.artifactAnomaly = 'failed';
  }
}

// forensics: the six cross-store lanes (monitor/forensics.mjs). Read-only, never fatal, and it
// files nothing — it produces leads and an inventory. Runs FLEET-ONCE rather than per-batch:
// store-consistency and coincidence read this repository's own stores, and observables reads every
// declared repo, so an --all parent's children would each recompute the identical answer.
if (process.env.CW_SWEEP_CHILD) {
  // Nothing printed: the parent reports the real result.
} else if (process.env.CW_SWEEP_NO_FORENSICS === '1') {
  console.log(`${TAG} forensics skipped (CW_SWEEP_NO_FORENSICS=1)`);
  verdictParts.forensics = 'skipped';
} else {
  console.log(`${TAG} forensics`);
  try {
    const { runForensics } = await import('./forensics.mjs');
    const { writeAtomic } = await import('./lockfile.mjs');
    const report = await runForensics();
    const outPath = process.env.CW_FORENSICS_OUT || join(CW, reg.reportsRoot || 'reports', 'forensics.json');
    writeAtomic(outPath, `${JSON.stringify(report, null, 2)}\n`);

    const sc = report.lanes['store-consistency'];
    if (sc && sc.configured) {
      const t = sc.totals;
      const n = t.orphan + t.widow + t.mismatch;
      if (n) console.log(`${TAG} ${crit(`${n} store-consistency anomal${n === 1 ? 'y' : 'ies'}`)} — ${t.orphan} orphan, ${t.widow} widow, ${t.mismatch} mismatch`);
      else console.log(`${TAG} forensics: stores agree${sc.complete ? '' : ' over the pairs that could be read — INCOMPLETE'}`);
    }
    // The write log, verified at SWEEP time and not only when somebody opens the Report tab: an
    // area's chain can be broken, drifted, unrecorded or un-anchored for days before a panel read.
    // Read-only, per area, one line per problem; a clean fleet prints one line.
    try {
      const { verifyChain } = await import('./history-chain.mjs');
      const problems = [];
      let chained = 0, uncommitted = 0;
      for (const a of reg.areas || []) {
        const histDir = join(outDirFor(a.slug, reg), 'history');
        let idx = null;
        try { idx = JSON.parse(readFileSync(join(histDir, 'index.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') problems.push(`${a.slug}: history index unreadable (${e.code || e.message})`); continue; }
        const v = verifyChain(histDir, Array.isArray(idx) ? idx : [], { area: basename(outDirFor(a.slug, reg)), committed: true });
        if (!v.present) continue; // seals itself on its next rollup — not a problem yet, and not a pass
        chained++;
        if (v.brokenAt) problems.push(`${a.slug}: chain BROKEN at line ${v.brokenAt.line} (stamp ${v.brokenAt.stamp})`);
        if (v.drifted.length) problems.push(`${a.slug}: ${v.drifted.length} state(s) DRIFTED from what the chain recorded — ${v.drifted.slice(0, 3).map((d) => d.stamp).join(', ')}`);
        if (v.unrecorded.length) problems.push(`${a.slug}: ${v.unrecorded.length} index row(s) the chain never saw — ${v.unrecorded.slice(0, 3).join(', ')}`);
        if (v.tailTorn) problems.push(`${a.slug}: chain has a torn tail line`);
        if (v.anchorMissing || v.anchorShrunk) problems.push(`${a.slug}: anchor disagrees — ${v.anchorWhy}`);
        // the committed copy is the one a local writer cannot rewrite; false is a contradiction, null is undetermined
        if (v.committed === false) problems.push(`${a.slug}: COMMITTED anchor disagrees — ${v.committedWhy}`);
        else if (v.committed === null) uncommitted++;
      }
      if (problems.length) for (const p of problems) console.log(`${TAG} ${crit('chain')} ${p}`);
      else console.log(`${TAG} chains: ${chained} area(s) verified against their write log${chained ? '' : ' — none chained yet'}${uncommitted ? ` · ${uncommitted} with no committed anchor yet (local consistency only)` : ''}`);
      // CW_ANCHOR_COMMIT=1: land the anchor store in the sidecar by pathspec, so the tips just
      // written exist somewhere this process cannot rewrite. Off by default — a sweep making
      // commits in another repository is a policy the operator turns on, not one it inherits.
      if (process.env.CW_ANCHOR_COMMIT === '1') {
        const { anchorCommit } = await import('../bin/anchor-commit.mjs');
        const r = anchorCommit({ push: process.env.CW_ANCHOR_COMMIT_PUSH === '1', log: (m) => console.log(`${TAG} ${m}`) });
        if (r.code) console.log(`${TAG} ${crit('anchor-commit')} ${r.why}`);
        else console.log(`${TAG} anchor-commit: ${r.committed ? `${r.sha}${r.pushed ? ' pushed' : ' (not pushed)'}` : r.why}`);
      }
    } catch (e) { console.log(`${TAG} chain verification did not run (${e && e.message || e}) — not a pass`); }
    const ob = report.lanes.observables;
    if (ob && ob.configured) console.log(`${TAG} forensics: ${ob.corpusSize} observable(s), top origin ${ob.hosts[0]?.host ?? '—'}`);
    const co = report.lanes.coincidence;
    if (co && co.configured) console.log(`${TAG} forensics: ${co.leadCount} cross-kind lead(s) over ${co.events} event(s)`);
    // An unconfigured lane is announced EVERY sweep on purpose. A lane nobody has fed is a coverage
    // void, and a void that stops being mentioned is a void that reads as a pass.
    for (const lane of report.lanesUnconfigured) console.log(`${TAG} forensics: ${lane} NOT CONFIGURED — no result, which is not a zero`);
    for (const lane of report.lanesFailed) console.error(`${TAG} forensics: ${lane} FAILED — ${report.lanes[lane].error}`);

    verdictParts.forensics = {
      ok: true, complete: report.complete,
      lanesRun: report.lanesRun, unconfigured: report.lanesUnconfigured, failed: report.lanesFailed,
      storeAnomalies: sc && sc.configured ? sc.totals : null,
      corpusSize: ob && ob.configured ? ob.corpusSize : null,
      leads: co && co.configured ? co.leadCount : null,
    };
  } catch (e) {
    console.error(`${TAG} forensics failed (non-fatal): ${e.message}`);
    verdictParts.forensics = 'failed';
  }
}

// unknown-rate: what fraction of the cells we PUBLISH is an unknown, by reason and by lane
// (monitor/unknown-rate.mjs — the fleet-scope call the unknown unification was built for).
// Fleet-once, read-only over rollups already written this sweep, never fatal. Runs AFTER the
// batches so it reads the slice this sweep produced rather than the previous one.
if (process.env.CW_SWEEP_CHILD) {
  // Nothing printed: the parent reports the real result.
} else if (process.env.CW_SWEEP_NO_UNKNOWN_RATE === '1') {
  console.log(`${TAG} unknown-rate skipped (CW_SWEEP_NO_UNKNOWN_RATE=1)`);
  verdictParts.unknownRate = 'skipped';
} else {
  try {
    const raw = execFileSync('node', [join(CW, 'monitor', 'unknown-rate.mjs')], { encoding: 'utf8' });
    for (const line of raw.trim().split('\n').filter(Boolean)) console.log(`${TAG} ${line}`);
    verdictParts.unknownRate = 'ok';
  } catch (e) {
    console.error(`${TAG} unknown-rate failed (non-fatal): ${e.message}`);
    verdictParts.unknownRate = 'failed';
  }
}

// lane-capability: which lanes can actually SPEAK — every extractor executed against a golden
// fixture, classified counting / shape-only / zero-on-golden / no-fixture, with declared-additive-
// but-cannot-count published as a DEFECT (monitor/lane-capability.mjs). Fleet-once, non-fatal.
if (process.env.CW_SWEEP_CHILD) {
  // Nothing printed: the parent reports the real result.
} else if (process.env.CW_SWEEP_NO_LANE_CAPABILITY === '1') {
  console.log(`${TAG} lane-capability skipped (CW_SWEEP_NO_LANE_CAPABILITY=1)`);
  verdictParts.laneCapability = 'skipped';
} else {
  try {
    const raw = execFileSync('node', [join(CW, 'monitor', 'lane-capability.mjs')], { encoding: 'utf8' });
    for (const line of raw.trim().split('\n').filter(Boolean)) console.log(`${TAG} ${line}`);
    verdictParts.laneCapability = 'ok';
  } catch (e) {
    console.error(`${TAG} lane-capability failed (non-fatal): ${e.message}`);
    verdictParts.laneCapability = 'failed';
  }
}

// surface-census: unscanned SOURCE surface as first-class grey — per repo × language, surface
// present vs lanes that can, did, and demonstrably read it (monitor/surface-census.mjs). Runs
// after the batches so the census joins against the slice this sweep produced. Fleet-once,
// non-fatal.
if (process.env.CW_SWEEP_CHILD) {
  // Nothing printed: the parent reports the real result.
} else if (process.env.CW_SWEEP_NO_SURFACE_CENSUS === '1') {
  console.log(`${TAG} surface-census skipped (CW_SWEEP_NO_SURFACE_CENSUS=1)`);
  verdictParts.surfaceCensus = 'skipped';
} else {
  try {
    const raw = execFileSync('node', [join(CW, 'monitor', 'surface-census.mjs')], { encoding: 'utf8' });
    for (const line of raw.trim().split('\n').filter(Boolean)) console.log(`${TAG} ${line}`);
    verdictParts.surfaceCensus = 'ok';
  } catch (e) {
    console.error(`${TAG} surface-census failed (non-fatal): ${e.message}`);
    verdictParts.surfaceCensus = 'failed';
  }
}

// lane-reach: did the dependency lane READ the manifests that exist — present vs gate-fired vs
// demonstrably consumed, from osv-scanner's own log (monitor/lane-reach.mjs). Fleet-once,
// non-fatal, after the batches so it reads this sweep's logs.
if (process.env.CW_SWEEP_CHILD) {
  // Nothing printed: the parent reports the real result.
} else if (process.env.CW_SWEEP_NO_LANE_REACH === '1') {
  console.log(`${TAG} lane-reach skipped (CW_SWEEP_NO_LANE_REACH=1)`);
  verdictParts.laneReach = 'skipped';
} else {
  try {
    const raw = execFileSync('node', [join(CW, 'monitor', 'lane-reach.mjs')], { encoding: 'utf8' });
    for (const line of raw.trim().split('\n').filter(Boolean)) console.log(`${TAG} ${line}`);
    verdictParts.laneReach = 'ok';
  } catch (e) {
    console.error(`${TAG} lane-reach failed (non-fatal): ${e.message}`);
    verdictParts.laneReach = 'failed';
  }
}

// canary harness: plant a known-bad state, run the REAL gate, score against a fixed truth.
// --require makes an unhostable tree fail loudly (skips must not read as all-clear). Spawned —
// its exit-code vocabulary IS the result. Fleet-once: it tests gates and it WRITES, so --all
// children must not multiply its records. CW_CANARY_NO_WRITE=1 disables writing.
if (process.env.CW_SWEEP_CHILD) {
  verdictParts.canary = 'child';
} else if (process.env.CW_SWEEP_NO_CANARY === '1') {
  console.log(`${TAG} canary-harness skipped (CW_SWEEP_NO_CANARY=1)`);
  verdictParts.canary = 'skipped';
} else {
  console.log(`${TAG} canary-harness`);
  const REQUIRED = process.env.CW_CANARY_REQUIRE
    || 'R-CLEAN,R-DRIFT,R-CORRUPT,R-ADVICE-UNKNOWN,R-CLAIM-MINE,R-CLAIM-THEIRS,R-CLAIM-SHARED,R-CLAIM-STALE,R-STUCK';
  try {
    let raw = '';
    let code = 0;
    try {
      raw = execFileSync('node', [join(CW, 'bin', 'canary-harness.mjs'), '--require', REQUIRED, '--json',
        ...(process.env.CW_CANARY_NO_WRITE === '1' ? [] : ['--write'])],
        { cwd: CW, encoding: 'utf8', timeout: 1_800_000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      // A non-zero exit is the scorecard, not a crash — keep stdout.
      code = typeof e.status === 'number' ? e.status : 1;
      raw = String(e.stdout || '');
    }
    const { summary, results } = JSON.parse(raw);
    const bad = summary.falseClean || summary.attributionWrong || 0;
    if (bad || summary.requiredSkipped?.length) {
      console.log(`${TAG} ${crit(`canary: ${summary.falseClean} false-clean · ${summary.attributionWrong || 0} misattributed`
        + `${summary.requiredSkipped?.length ? ` · ${summary.requiredSkipped.length} REQUIRED scenario(s) could not run (${summary.requiredSkipped.join(', ')})` : ''}`)}`);
    } else {
      console.log(`${TAG} canary: ${summary.correct}/${summary.scored} correct · ${summary.falseAlarm} false-alarm`);
    }
    verdictParts.canary = { exit: code, summary, results };
    const cv = canaryVerdict(verdictParts.canary);
    const pct = (r) => (r.state === 'measured' ? `${r.n}/${r.of} (${Math.round(r.rate * 100)}%)` : 'not measured');
    console.log(`${TAG} gate error rate: false-clean ${pct(cv.falseClean || {})} ${dim('·')} false-alarm ${pct(cv.falseAlarm || {})}`);
  } catch (e) {
    // Non-fatal for the sweep; 'failed' is its own state, never silently absent.
    console.error(`${TAG} canary-harness failed (non-fatal): ${e.message}`);
    verdictParts.canary = 'failed';
  }
}

// verdict-journal anchors: off-tree checkpoints so a rewritten/truncated journal alarms later.
// Spawned (the CLI is the only entry point); runs after every batch, never hoisted fleet-once.
if (process.env.CW_SWEEP_NO_ANCHOR === '1') {
  console.log(`${TAG} verdict-journal anchor skipped (CW_SWEEP_NO_ANCHOR=1)`);
  verdictParts.verdictAnchor = 'skipped';
} else {
  console.log(`${TAG} verdict-journal anchor`);
  let anchorOk = true;
  // Bounded: a finished anchor run deadlocked in Node 26.7 teardown on 2026-09-18 and held its area 4h.
  const ANCHOR_TIMEOUT_MS = Math.max(10_000, Number(process.env.CW_SWEEP_ANCHOR_TIMEOUT_MS) || 5 * 60 * 1000);
  try { execFileSync('node', [join(CW, 'bin', 'verdict-journal.mjs'), '--anchor'], { stdio: 'inherit', timeout: ANCHOR_TIMEOUT_MS, killSignal: 'SIGKILL' }); }
  catch (e) { anchorOk = false; console.error(`${TAG} verdict-journal --anchor failed (non-fatal): ${e.message}`); }
  try { execFileSync('node', [join(CW, 'bin', 'verdict-journal.mjs'), '--anchor-data'], { stdio: 'inherit', timeout: ANCHOR_TIMEOUT_MS, killSignal: 'SIGKILL' }); }
  catch (e) { anchorOk = false; console.error(`${TAG} verdict-journal --anchor-data failed (non-fatal): ${e.message}`); }
  verdictParts.verdictAnchor = anchorOk ? 'ok' : 'failed';

  // Off-host witness of the anchor stores' heads (bin/anchor-witness.mjs). Once per sweep, not
  // once per area: a fleet run has 27 children and they would each push the same fact. Never
  // fatal — a witness that cannot be recorded is a state to report, not a reason to lose the
  // sweep — but a REGRESSION (exit 1) is an integrity alarm and says so.
  if (!process.env.CW_SWEEP_CHILD) {
    const wr = spawnSync('node', [join(CW, 'bin', 'anchor-witness.mjs'), '--json'],
      { encoding: 'utf8', timeout: Math.max(10_000, Number(process.env.CW_SWEEP_WITNESS_TIMEOUT_MS) || 120_000) });
    let w = null;
    try { w = JSON.parse(wr.stdout || 'null'); } catch { /* reported below as unreadable */ }
    verdictParts.anchorWitness = w ? { state: w.state, pushed: Boolean(w.pushed) } : { state: wr.error ? `failed: ${wr.error.message}` : 'unreadable' };
    if (wr.status === 1) console.error(crit(`${TAG} anchor witness REGRESSION — ${[].concat(w?.detail || 'see bin/anchor-witness.mjs --json').join('; ')}`));
    else console.log(`${TAG} anchor witness: ${verdictParts.anchorWitness.state}${verdictParts.anchorWitness.pushed ? ' (pushed)' : ''}`);

    // And the local half: does the OFF-BOX watcher still run at all? Its own alarms are red
    // workflow runs in a private repository, which is not a route — measured 2026-09-24, every
    // workflow there had failed at startup since 2026-09-19 and nothing here noticed for five days.
    // Same posture as the witness step: bounded, once per sweep, never fatal.
    const ow = spawnSync('node', [join(CW, 'bin', 'offbox-watch-check.mjs'), '--json'],
      { encoding: 'utf8', timeout: Math.max(10_000, Number(process.env.CW_SWEEP_OFFBOX_TIMEOUT_MS) || 120_000) });
    let owr = null;
    try { owr = JSON.parse(ow.stdout || 'null'); } catch { /* reported below as unreadable */ }
    verdictParts.offboxWatch = owr ? { state: owr.state, ledgerAgeH: owr.ledgerAgeH ?? null } : { state: ow.error ? `failed: ${ow.error.message}` : 'unreadable' };
    if (ow.status === 1) console.error(crit(`${TAG} off-box watcher ${owr?.state || 'ALARM'} — ${owr?.detail || (owr?.alarms || []).join('; ') || 'see bin/offbox-watch-check.mjs --json'}`));
    else console.log(`${TAG} off-box watcher: ${verdictParts.offboxWatch.state}`);
  }
}

// remediation-outcome: did a remediation claim hold as of this slice? Module call, per-area,
// gated like `issues`; refuted claims surface loudly on stderr.
if (scopeArea && !nothingToRollUp) {
  if (process.env.CW_SWEEP_NO_REMEDIATION_OUTCOME === '1') {
    console.log(`${TAG} remediation-outcome skipped (CW_SWEEP_NO_REMEDIATION_OUTCOME=1)`);
    verdictParts.remediationOutcome = 'skipped';
  } else {
    console.log(`${TAG} remediation-outcome`);
    try {
      const { runRemediationOutcome } = await import('./remediation-outcome.mjs');
      const res = runRemediationOutcome({
        outDir: OUT_DIR,
        annotationsPath: annotationsPathFor(CW),
        ledgerPath: join(OUT_DIR, 'remediation-ledger.json'),
        write: true,
      });
      for (const line of res.loudLines) console.error(`${TAG} ${crit(line)}`);
      for (const err of res.errors) console.error(`${TAG} remediation-outcome error: ${err}`);
      console.log(`${TAG} remediation-outcome: ${res.verifiedFixed} verified-fixed ${dim('·')} ${res.refutedStillPresent} refuted ${dim('·')} `
        + `${res.skipped} not comparable ${dim('·')} ${res.alreadyRecorded} already recorded`);
      verdictParts.remediationOutcome = { ok: res.ok, verifiedFixed: res.verifiedFixed, refutedStillPresent: res.refutedStillPresent, skipped: res.skipped };
    } catch (e) {
      console.error(`${TAG} remediation-outcome failed (non-fatal): ${e.message}`);
      verdictParts.remediationOutcome = 'failed';
    }
  }
} else {
  verdictParts.remediationOutcome = 'skipped';
}

// rebuild the temporal viewer (timeline.html) — best-effort, fleet-wide (children skip),
// skipped when there was nothing to roll up.
if (!process.env.CW_SWEEP_CHILD && !nothingToRollUp) {
  console.log(`${TAG} timeline`);
  try { execFileSync('node', [join(HERE, 'timeline.mjs')], { stdio: 'inherit', env: childEnv }); (verdictParts.finalize ??= {}).timeline = 'ok'; }
  catch { (verdictParts.finalize ??= {}).timeline = 'failed'; /* never block the sweep on the viewer */ }
}

// rebuild the runtime (DAST/BOLA) report — best-effort, fleet-wide (children skip).
if (!process.env.CW_SWEEP_CHILD) {
  console.log(`${TAG} runtime`);
  try { execFileSync('node', [join(HERE, 'runtime-report.mjs')], { stdio: 'inherit', env: childEnv }); (verdictParts.finalize ??= {}).runtime = 'ok'; }
  catch { (verdictParts.finalize ??= {}).runtime = 'failed'; /* never block the sweep on the runtime report */ }
}

// races scan (bin/races.mjs) — fast offline tier (semgrep + spotbugs), best-effort, per-area
// (writes reports/<area>/races/, so each child runs its own).
console.log(`${TAG} races`);
if (racesArea) {
  try { execFileSync('node', [join(CW, 'bin', 'races.mjs'), '--project', racesArea, '--engines', RACES_ENGINES], { stdio: 'inherit', env: childEnv }); verdictParts.races = 'ran'; }
  catch { verdictParts.races = 'failed'; /* never block the sweep on the races scan */ }
} else {
  verdictParts.races = 'skipped';
  console.log(`${TAG} races skipped (area ${scopeArea || '?'} does not declare races:true)`);
}

// retention: slim old batches — unbounded growth once filled the volume. Never blocks the sweep;
// fleet-wide (children skip).
if (!process.env.CW_SWEEP_CHILD) {
  console.log(`${TAG} compact`);
  try { execFileSync('node', [join(HERE, 'compact-reports.mjs'), '--apply'], { stdio: 'inherit' }); (verdictParts.finalize ??= {}).compact = 'ok'; }
  catch (e) { console.log(`${TAG} compact failed (non-fatal): ${e.message}`); (verdictParts.finalize ??= {}).compact = 'failed'; }
}

// export the fresh rollup into the Portll overwatch-layer so internal-d's overlook can
// reason over audit history. Best-effort + health-gated inside the script;
// disable with SUBSTRATE_EXPORT=0.
// The child exits 0 on every outcome, so its exit code is not evidence; the receipts it writes
// beside the rollup are, and they are classified into the verdict here (M0 task 1). `since` is
// what keeps the previous run's receipts file from being read as this slice's outcome.
if (process.env.SUBSTRATE_EXPORT !== '0') {
  // the SWEPT area's rollup, not the primary area's — this shipped the wrong area's results
  const rollupJson = join(OUT_DIR, 'rollup.json');
  try {
    execFileSync('node', [join(HERE, 'export-overwatch.mjs'), rollupJson], { stdio: 'inherit' });
  } catch { /* never block the sweep on the overwatch-layer */ }
  const mh = readExportHealth({ dir: OUT_DIR, since: START_ISO });
  verdictParts.memoryExport = exportVerdict(mh);
  console.log(`${TAG} ${exportHealthLine(mh)}`);
} else {
  verdictParts.memoryExport = exportVerdict(skippedExport('SUBSTRATE_EXPORT=0 — the export was switched off for this run'));
  console.log(`${TAG} memory export SKIPPED (SUBSTRATE_EXPORT=0) — nothing was written and nothing is claimed`);
}

// modernization map — opt-in (MAP_REFRESH=1 or --map), best-effort.
if (process.env.MAP_REFRESH === '1' || process.argv.includes('--map')) {
  // refresh the map of the area just swept, not a fixed project
  const proj = process.env.MAP_PROJECT || scopeArea || primaryArea(reg)?.slug;
  try { execFileSync('node', [join(HERE, 'modernization.mjs')], { stdio: 'inherit', env: childEnv }); } catch { /* KPI json best-effort */ }
  try {
    console.log(`${TAG} rendering modernization map (${proj}) from map/render.mjs`);
    execFileSync('node', [join(CW, 'map', 'render.mjs'), proj], { stdio: 'inherit' });
  } catch (e) { console.log(`${TAG} map render failed (non-fatal): ${e.message}`); }
} else {
  console.log(`${TAG} map refresh skipped (set MAP_REFRESH=1 or pass --map)`);
}

// refresh PROJECTSTATUS.md — best-effort, fleet-wide (children skip). CW_PROJECTSTATUS=0 skips
// it (the on-commit hook must not re-dirty the tracked doc); the skip is stated, never silent.
if (!process.env.CW_SWEEP_CHILD) {
  if (process.env.CW_PROJECTSTATUS === '0') {
    console.log(`${TAG} projectstatus refresh skipped (CW_PROJECTSTATUS=0 — the tracked doc is left to scheduled/manual sweeps)`);
    (verdictParts.finalize ??= {}).projectstatus = 'skipped';
  } else {
    try { execFileSync('node', [join(CW, 'bin', 'projectstatus.mjs')], { stdio: 'inherit' }); (verdictParts.finalize ??= {}).projectstatus = 'ok'; }
    catch (e) { console.log(`${TAG} projectstatus refresh failed (non-fatal):`, e.message); (verdictParts.finalize ??= {}).projectstatus = 'failed'; }
  }
}

// how much of THIS batch ran confined, and which lanes ran a repo's own code unsandboxed
// (monitor/sandbox-coverage.mjs). Read-only over the rows already written; never blocks the sweep.
try { console.log(`${TAG} ${sandboxCoverageLine(sandboxCoverage({ sweepDir: batchDir }))}`); }
catch (e) { console.error(`${TAG} sandbox-coverage failed (non-fatal): ${e.message}`); }

// ── THE SWEEP'S OWN VERDICT ─────────────────────────────────────────────────────────────────
// batch-verdict.json beside the manifest + one line in OUT_DIR/sweep-journal.jsonl. Structured
// fields only (tunnel-served); best-effort with a loud failure line.
let verdictRecorded = false;
try {
  const rec = buildAreaVerdict({
    sliceId: `sweep-${stamp}`, area: scopeArea, group, sweptAll: sweepAll,
    repos: {
      resolved: repos.length, present: present.length, scanned, missing: repos.filter((r) => !existsSync(r.path)).map((r) => r.name),
      // K7: one outcome per manifest run, so a lane reading `absent` can be traced to the scan that
      // did not run rather than to a repo that was never in scope.
      scans: scanOutcomes.map(({ name, manifest, code, ran, why }) => ({ name, manifest, code, ran, why })),
    },
    ...verdictParts,
    startedAt: START_ISO, finishedAt: new Date().toISOString(),
    durationSecs: Math.round((Date.now() - START_MS) / 1000),
  }, { root: CW });
  const tmpV = join(batchDir, `batch-verdict.json.tmp-${process.pid}`);
  writeFileSync(tmpV, `${JSON.stringify(rec, null, 2)}\n`);
  renameSync(tmpV, join(batchDir, 'batch-verdict.json'));
  const w = appendRecord(join(OUT_DIR, 'sweep-journal.jsonl'), rec);
  if (!w.ok) console.error(`${TAG} sweep verdict journal write failed (${w.error}) — this slice's verdict is NOT recorded`);
  verdictRecorded = !!w.ok;
} catch (e) {
  // Still non-fatal to the SWEEP — the scans and rollup above stand — but no longer invisible: the
  // exit below carries it, which is what the 2026-08-11 run's 29 silent failures lacked.
  console.error(`${TAG} verdict record failed (this slice's verdict is NOT recorded; the exit code says so): ${e.message}`);
}
{
  const failedSteps = Object.entries({ ...verdictParts.steps, ...(verdictParts.finalize || {}) })
    .filter(([, v]) => v === 'failed').map(([k]) => k)
    .concat(['rollup', 'preflight', 'issues', 'learning', 'artifactAnomaly', 'forensics', 'hostInventory'].filter((k) => verdictParts[k] === 'failed'))
    // A broken export reaches the done line but never the exit code: sweepExit() summarises failed
    // steps without moving it, and a lane that turns the whole sweep red for a backend outage is a
    // lane somebody switches off (the A4 argument in sweep-verdict.mjs).
    .concat(verdictParts.memoryExport && verdictParts.memoryExport.kind === 'broken'
      ? [`memoryExport:${verdictParts.memoryExport.state}`] : []);
  const x = sweepExit({ scans: scanOutcomes, verdictRecorded, failedSteps });
  console.log(`${TAG} done — ${x.line}`);
  await exitFlushed(x.exit);
}
