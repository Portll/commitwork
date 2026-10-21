#!/usr/bin/env node
// liveness.mjs — the sweep deadman: classifies every area's rollup freshness against wall-clock
// now. Exit 1 on expired/unknown/hung/tampered; degraded/stale/never-swept warn; unscheduled
// (undeclared area) never trips — an alarm nobody can satisfy gets muted.
//
// Usage: node monitor/liveness.mjs [path/to/rollup.json]   (explicit path ⇒ single-area)
//        node monitor/liveness.mjs                          (fan out over all areas)
//        CW_ROLLUP=<path> also selects the single-area form.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { classifyFreshness, freshnessSummary } from './freshness.mjs';
import { readRollupHead } from './rollup-head.mjs';
// Static imports: neither module reads anything at import (area.mjs says so in its own header);
// the file read happens in loadRegistry(), which areaSnapshot() below calls at CALL time.
import { loadRegistry, areaOut, registryPath } from './registry.mjs';
import { reportsRootDir } from './area.mjs';
import { readJournalFile, readJournal, journalHealth, journal } from '../bin/lib/verdict-journal-core.mjs';
import { bandOf } from '../lib/chain-lexicon.mjs';
import { defaultPidAlive } from './sweep-health.mjs';
import { serviceHealth, watcherPulse } from './service-health.mjs';
import { headSha } from '../bin/head-sha.mjs';
import { measuredFromArtifact } from '../bin/measured.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { stateBaseFor } from './store-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
// True only when run directly — importing (tests) must never read argv, print, or exit.
const isMain = isMainModule(import.meta.url);

// Rank worst-first so the exit code reflects the worst area, never the last one checked.
//
// `paused: 0` — a deliberately quiet area is NOT a finding. It is the operator's own instruction
// reflected back, and ranking it above 0 produces an alarm nobody can clear, which is how a reader
// learns to stop reading this signal at all (see install-agents.mjs on `cadenceMs`).
//
// RANKING IT 0 IS NOT SUFFICIENT, AND THE REASON IS COUNTERINTUITIVE: rank 0 is the TRIGGER for the
// unjournaled rewrite below (`if ((RANK[state] ?? 0) === 0) state = 'unjournaled'`). So calling a
// paused area benign is exactly what walks it into being re-alarmed as `unjournaled` — rank 1 —
// the moment its journal lags, which it always will, because nothing is sweeping it. Both rewrite
// sites therefore exclude `paused` explicitly. Ranking a state and exempting it from a rewrite that
// keys on that rank are two separate edits, and doing only the first looks complete.
//
// THE TWO DEFAULTS DISAGREE. `RANK[state] ?? 0` (the rewrite sites) treats an UNRECOGNISED state as
// benign; `RANK[r.state] ?? 3` (the exit and alarm sites) ranks the same state worst and alarms. One
// state, two verdicts, decided by which line reads it, so a new state needs its own RANK entry.
export const RANK = { unknown: 3, expired: 3, hung: 3, tampered: 3, stale: 1, degraded: 1, 'never-swept': 1, unjournaled: 1, overrunning: 1, pending: 0, fresh: 0, unscheduled: 0, paused: 0 };

// ── THE START-MARKER DEADMAN: "a sweep that never finished" ─────────────────────────────────────
// A marker older than the threshold is a HUNG sweep and alarms even beside a fresh rollup.
// Fail closed: a marker that exists but cannot be read (or has no parseable startedAt) is hung.
export const INFLIGHT_FILE = '.sweep-inflight.json';
// 4h says "no plausible sweep is still legitimately running"; env-overridable.
export const INFLIGHT_MAX_MS_DEFAULT = 4 * 60 * 60 * 1000;
export function readInflight(dir, { nowMs = Date.now(), inflightMaxMs } = {}) {
  const maxMs = inflightMaxMs ?? (Number(process.env.CW_SWEEP_INFLIGHT_MAX_MS) || INFLIGHT_MAX_MS_DEFAULT);
  let raw;
  try { raw = readFileSync(join(dir, INFLIGHT_FILE), 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return { verdict: 'none' };            // legitimately absent — no sweep in flight
    return { verdict: 'unreadable', detail: e.code || 'error' };    // fail closed
  }
  let j;
  try { j = JSON.parse(raw); } catch { return { verdict: 'unreadable', detail: 'unparseable' }; }
  const t = Date.parse(j && j.startedAt);
  if (!Number.isFinite(t)) return { verdict: 'unreadable', detail: 'no parseable startedAt' };
  const ageMs = Math.max(0, nowMs - t);
  const common = { ageMin: Math.round(ageMs / 60000), sliceId: (j && j.sliceId) || null, startedAt: j.startedAt, pid: (j && j.pid) ?? null };
  // ── AGE WAS NEVER THE DISCRIMINATOR; THE PID IS ────────────────────────────────────────────────
  // One fleet-wide age threshold is wrong in BOTH directions: a big area's healthy sweep crosses it
  // on every normal run, an alarm a reader learns to ignore, while a sweep whose pid died early
  // goes unreported until the threshold passes.
  //
  // A DEAD pid with a standing marker is a hang AT ANY AGE — that is strictly stronger detection
  // than an age threshold, not weaker. A LIVE pid past the threshold is a long sweep, which is a
  // different fact and gets its own state rather than borrowing the failure's.
  //
  // The probe comes from sweep-health.mjs so the panel and this deadman cannot disagree about what
  // EPERM means; two copies of that table is how one surface calls a sweep alive and the other
  // calls it dead.
  const pid = common.pid;
  if (!Number.isInteger(pid) || pid <= 0) {
    // Unprobeable. Keep EXACTLY the age-only posture here rather than inventing a verdict: a
    // marker written before pids were recorded must not become quietly un-alarmable.
    return { ...common, verdict: ageMs > maxMs ? 'hung' : 'inflight', pidState: 'unprobeable' };
  }
  let alive;
  try { alive = defaultPidAlive(pid) === true; }
  catch (e) {
    // The probe itself failed in a way the shared table cannot place. Liveness of the sweep is
    // UNKNOWN, so fall back to the age-only answer, and say why.
    return { ...common, verdict: ageMs > maxMs ? 'hung' : 'inflight', pidState: `unprobeable (${e.code || 'error'})` };
  }
  if (!alive) return { ...common, verdict: 'hung', pidState: 'dead' };
  return { ...common, verdict: ageMs > maxMs ? 'overrunning' : 'inflight', pidState: 'alive' };
}

// `scheduled` is false only in fan-out mode, for a discovered dir that no areas[] block declares.
export function checkOne(path, label, { scheduled = true, missingOk = false, nowMs, inflightMaxMs, rawSink } = {}) {
  // One effective "now" for the whole call — an injected nowMs is honoured everywhere.
  const effectiveNow = nowMs ?? Date.now();
  // Start marker read first: a hung sweep must alarm even when the rollup would classify quieter.
  const inflight = readInflight(dirname(path), { nowMs: effectiveNow, inflightMaxMs });
  const hungLine = () => inflight.verdict === 'hung'
    ? `sweep HUNG — in-flight marker (slice ${inflight.sliceId ?? '?'}) started ${inflight.ageMin} min ago and was never cleared; `
      + (inflight.pidState === 'dead'
        ? `pid ${inflight.pid} is DEAD, so nothing is running and nothing was published`
        : `the sweep did not finish and nothing was published (pid ${inflight.pidState ?? 'unprobeable'})`)
    : `sweep state UNDETERMINABLE — in-flight marker exists but cannot be read (${inflight.detail}); failing closed, treat as hung`;
  // A LONG sweep, said as one. Named separately from `hung` so a reader can tell "still working" from
  // "died without publishing".
  const overrunLine = () => `sweep OVERRUNNING — in-flight marker (slice ${inflight.sliceId ?? '?'}) started `
    + `${inflight.ageMin} min ago, past the ${Math.round((inflightMaxMs ?? (Number(process.env.CW_SWEEP_INFLIGHT_MAX_MS) || INFLIGHT_MAX_MS_DEFAULT)) / 60000)} min threshold — `
    + `but pid ${inflight.pid} is ALIVE, so it is still running, not hung. Raise this area's threshold `
    + `if its healthy runs are legitimately this long (panel: Settings -> hang-threshold overrides).`;
  let rollup;
  // rawSink collects raw rollup bytes for measured.digest; an unreadable rollup contributes its
  // failure code — "could not read" is a state of the source, not an absence of measurement.
  try {
    if (rawSink) {
      const rawRollup = readFileSync(path, 'utf8');
      rawSink.push(`${path}\n${rawRollup}`);
      rollup = JSON.parse(rawRollup);
    } else {
      // No digest wanted (the panel's fleet overview): the memoised head carries every field read below.
      const h = readRollupHead(path);
      if (!h.ok) throw h.error;
      rollup = h.head;
    }
  } catch (e) {
    if (rawSink) rawSink.push(`${path}\nUNREADABLE:${e.code || 'unparseable'}`);
    if (inflight.verdict === 'hung' || inflight.verdict === 'unreadable') return { label, state: 'hung', line: `${label}: ${hungLine()} (no rollup at ${path})` };
    if (inflight.verdict === 'overrunning') return { label, state: 'overrunning', line: `${label}: ${overrunLine()} (no rollup at ${path} yet)` };
    if (inflight.verdict === 'inflight') return { label, state: 'pending', line: `${label}: first sweep in flight (started ${inflight.ageMin} min ago, slice ${inflight.sliceId ?? '?'}) — no rollup yet` };
    if (missingOk && e.code === 'ENOENT') {
      // A declared area with no rollup and no marker: no sweep ever finished or started here.
      return { label, state: 'never-swept', line: `${label}: declared in monitor/projects.json areas[] but NO rollup has ever been written and no sweep is in flight — a coverage void, not a clean area` };
    }
    return { label, state: 'unknown', line: `${label}: cannot read rollup at ${path}: ${e.message}` };
  }
  if (inflight.verdict === 'overrunning') {
    return { label, state: 'overrunning', line: `${label}: ${overrunLine()} (last published slice ${rollup.sliceId ?? '?'}, generated ${rollup.freshness?.generated ?? rollup.generated ?? 'n/a'})` };
  }
  if (inflight.verdict === 'hung' || inflight.verdict === 'unreadable') {
    return { label, state: 'hung', line: `${label}: ${hungLine()} (last published slice ${rollup.sliceId ?? '?'}, generated ${rollup.freshness?.generated ?? rollup.generated ?? 'n/a'})` };
  }
  const generated = rollup.freshness?.generated ?? rollup.generated;
  const threshold = { ...(rollup.freshness?.threshold ?? {}) };
  const declared = areaSnapshot();
  // Per-area cadence: the registry's declared cadenceMs wins over the slice's stamped default.
  // The stamped expireMs derives from the DAILY default (2 × 24h + grace); kept beside a weekly
  // cadence it would expire an area before its cadence was out, with no stale band between, so it
  // is dropped and re-derived from the declared cadence by classifyFreshness.
  if (declared.cadence.has(label)) { threshold.cadenceMs = declared.cadence.get(label); delete threshold.expireMs; }
  // CR-3: classify on the SCAN time (sliceId stamp), not the aggregation re-stamp; `generated`
  // still travels as lastRolledUp.
  // `paused` must be PASSED, not merely ranked. Adding it to RANK alone is a no-op: classifyFreshness
  // is the only thing that can return the state, and it only does so when told.
  // A marker without an effect is the failure this whole lane exists to refuse.
  const f = classifyFreshness(generated, effectiveNow,
    { ...threshold, sliceId: rollup.sliceId, paused: !!declared.paused.get(label) });
  let state = f.state;
  let summary = freshnessSummary(f);
  if (!scheduled && state !== 'fresh') {
    // Unscheduled takes priority over pending.
    state = 'unscheduled';
    summary = `unscheduled (${f.ageHours ?? '?'}h old) — not declared in monitor/projects.json areas[], `
      + 'so no generated agent sweeps it; it will never age out of this state on its own';
  } else if (isPendingArea(path, state)) {
    // A first-swept area with no history yet is new, not stale.
    state = 'pending';
    summary = 'pending (new area, no history yet)';
  }
  // S1 — coverage deadman: the degrade keys on coverage.unsweptInScope (repos this batch declared
  // and did not scan), never the fleet-wide unswept list, which is non-empty by construction for
  // a per-area sweep. The fleet number is reported but never alarms; old rollups without
  // unsweptInScope report the fleet gap and say the in-scope figure is unavailable.
  const cov = rollup.coverage;
  const unswept = cov && Array.isArray(cov.unswept) ? cov.unswept : [];
  const inScope = cov && Array.isArray(cov.unsweptInScope) ? cov.unsweptInScope : null;
  if (inScope && inScope.length) {
    const missNote = `${inScope.length} of the repo(s) THIS batch declared it would cover were never scanned (${inScope.slice(0, 8).join(', ')}${inScope.length > 8 ? ` … +${inScope.length - 8} more` : ''})`;
    if (state === 'fresh') {
      state = 'degraded';
      summary = `degraded — rollup is fresh but ${missNote}; a declared-but-unscanned repo is a coverage void, not a clean one`;
    } else {
      summary += ` · coverage: ${missNote}`;
    }
  }
  // Docker deadman — same shape as S1 above. A slice swept with the docker daemon down has every
  // container lane structurally void (deps-osv among them), so its zeros are voids, not clean
  // results. Keys STRICTLY on 'down':
  // 'ok' is healthy, 'unrecorded' (pre-field vintage) is explicit uncertainty, and 'absent' (docker not
  // installed) is a deliberate reduced deployment whose nightly alarm would train the operator
  // past the deadman — the S1 lesson. Down means installed-and-not-running: something broke.
  const dockerCap = rollup.capabilities && rollup.capabilities.docker;
  if (dockerCap === 'down') {
    const dockerNote = 'swept with the docker daemon DOWN — container lanes (deps-osv among them) are structurally void; zeros in this slice are voids, not clean results';
    if (state === 'fresh') {
      state = 'degraded';
      summary = `degraded — rollup is fresh but ${dockerNote}`;
    } else {
      summary += ` · ${dockerNote}`;
    }
  }
  if (unswept.length) {
    const rest = `${unswept.length} of ${cov.resolved ?? '?'} discovery-resolved repo(s) are outside this ${cov.scope ?? 'unknown'} batch${inScope ? '' : ' (in-scope coverage unavailable — rollup predates coverage.unsweptInScope)'}`;
    summary += ` · fleet: ${rest}`;
  }
  // A young marker is reported, never alarmed on — the numbers on screen are about to change.
  if (inflight.verdict === 'inflight') summary += ` · sweep in flight (started ${inflight.ageMin} min ago, slice ${inflight.sliceId ?? '?'})`;
  if (inflight.verdict === 'overrunning') summary += ` · sweep OVERRUNNING (${inflight.ageMin} min, pid ${inflight.pid} alive)`;
  // C19 — the sweep's own verdict journal. Absence alarms only when a sweep ran inside the
  // freshness window and left no line (a broken writer, not an era gap); a journal behind the
  // rollup, a broken chain, or an unreadable journal always rank.
  try {
    const vj = readJournalFile(join(dirname(path), 'sweep-journal.jsonl'));
    if (vj.absent) {
      const sweptRecently = state === 'fresh' || state === 'degraded';
      if (sweptRecently && rollup.sliceId) {
        if (state !== 'paused' && (RANK[state] ?? 0) === 0) state = 'unjournaled';
        summary += ` · verdict journal NEVER WRITTEN (rollup ${rollup.sliceId} is current) — a sweep ran and recorded nothing: a broken writer, not an era gap`;
      } else {
        summary += ' · verdict journal: none recorded';
      }
    } else {
      const last = vj.records.length ? vj.records[vj.records.length - 1] : null;
      const lagged = rollup.sliceId && (!last || (last.sliceId && last.sliceId < rollup.sliceId));
      if (vj.chain && vj.chain.broken) {
        // An edited journal outranks any freshness state — the instrument itself was touched.
        state = 'tampered';
        summary += ` · verdict journal CHAIN BROKEN ×${vj.chain.broken} — records were edited or removed`;
      } else if (lagged) {
        if (state !== 'paused' && (RANK[state] ?? 0) === 0) state = 'unjournaled';
        summary += ` · verdict journal BEHIND the rollup (journal ${last?.sliceId ?? 'empty'}, rollup ${rollup.sliceId}) — a sweep published state whose verdict was never recorded`;
      } else if (vj.torn) {
        summary += ` · verdict journal: ${vj.torn} torn line(s)`;
      }
    }
  } catch (e) {
    // DELIBERATELY NOT EXEMPT FOR `paused`, unlike the two rewrite sites above, and the line is
    // where it is: those two fire because nothing swept — which is what a pause MEANS, so alarming
    // on them re-alarms the operator's own instruction. This one fires because the journal is
    // UNREADABLE, which is an integrity failure of the instrument and is true whether or not the
    // area is paused. A paused area with a corrupt journal is still a corrupt journal.
    if ((RANK[state] ?? 0) === 0) state = 'unjournaled';
    summary += ` · verdict journal UNREADABLE (${e.code || 'error'}) — an unreadable journal never reads as an empty one`;
  }
  return { label, state, line: `${label}: ${summary} (slice ${rollup.sliceId ?? '?'}, generated ${generated ?? 'n/a'})` };
}

function isPendingArea(path, state) {
  if (state !== 'stale' && state !== 'expired') return false;
  return !existsSync(join(dirname(path), 'history'));
}

// ── THE DECLARED-AREA SNAPSHOT: cadence, pause, out-dirs and the reports root ────────────────────
// `cadence` is the declared per-area cadence, keyed by the area's OUT dir name (what we can see on
// disk). `paused` is read from the SAME declaration and keyed the same way, and passed to
// classifyFreshness as rollup.mjs passes it: without it a paused area classifies `expired` and
// alarms on every hourly run, an unclearable red that trains a reader to stop believing the
// freshness signal everywhere (see install-agents.mjs on `cadenceMs`).
//
// THE REGISTRY IS THE AUTHORITY HERE, NOT THE ROLLUP'S STAMP. rollup.freshness.paused records what
// was true when that sweep ran; this asks whether the area is paused NOW. An area paused after its
// last sweep must stop alarming immediately, and one un-paused after a sweep must resume alarming on
// the same run — reading the stamp would lag the operator's instruction by a whole sweep.
//
// READ AT CALL TIME, NOT AT MODULE LOAD, and the difference only shows up in a LONG-LIVED importer.
// The admin panel imports checkOne() to render fleet health and runs for days, so against a
// load-time snapshot the operator pauses an area, reloads the panel, and watches it keep alarming on
// the instruction it just gave. Same fix as admin/lib/core.mjs's registry() accessor: re-read when
// the file's mtime moves, keep the LAST GOOD snapshot when the re-read fails. It also keeps the
// CW_REGISTRY seam for anything that sets the env after importing this module.
//
// Never degrades to an empty snapshot: an unreadable registry keeps whatever was last good and falls
// through to disk discovery, because "no areas are declared" is a much stronger claim than "the
// registry could not be read just now" and would silently un-schedule every area.
let _areaSnap = null;
let _areaSnapMtime = -1;
function areaSnapshot() {
  let mtime = 0;
  try { const rp = registryPath(); mtime = existsSync(rp) ? statSync(rp).mtimeMs : 0; } catch { /* 0 forces a re-read */ }
  if (_areaSnap && mtime && mtime === _areaSnapMtime) return _areaSnap;
  const snap = { cadence: new Map(), paused: new Map(), areasOut: [], reportsRoot: join(stateBaseFor(CW), 'reports') };
  try {
    const reg = loadRegistry({ quiet: true });
    try { snap.reportsRoot = reportsRootDir(reg); } catch { /* keep the default */ }
    for (const a of reg.areas || []) {
      const out = areaOut(a.slug, reg);
      snap.areasOut.push(out);
      if (a.cadenceMs) snap.cadence.set(out, a.cadenceMs);
      if (a.paused) snap.paused.set(out, a.paused);
    }
  } catch {
    // registry unreadable ⇒ keep the last good snapshot if there is one, else fall back to the disk
    // discovery the caller does anyway. Never publish an empty declaration set as if it were read.
    if (_areaSnap) return _areaSnap;
  }
  _areaSnap = snap; _areaSnapMtime = mtime;
  return snap;
}

// Everything below only runs when this file is executed directly (see `isMain` above) — importing
// it (as the tests do, to exercise checkOne() directly) must never read this process's real argv,
// print, or call process.exit.
if (isMain) {
  const explicit = process.argv[2] || process.env.CW_ROLLUP;
  // Raw rollup bytes per area, deterministic order — the run's measurement provenance.
  const rawSink = [];
  let results;
  if (explicit) {
    results = [checkOne(explicit, 'sweep freshness', { rawSink })];
  } else {
    // Every area dir holding a rollup — declared areas first, then any others on disk.
    const declared = areaSnapshot();
    const root = declared.reportsRoot;
    const scheduledOut = new Set(declared.areasOut); // declared areas — install-agents.mjs schedules a sweep for each
    const dirs = new Set(declared.areasOut);
    try { for (const d of readdirSync(root, { withFileTypes: true })) if (d.isDirectory() && existsSync(join(root, d.name, 'rollup.json'))) dirs.add(d.name); } catch { /* no reports tree yet */ }
    // Declared areas are checked even with no rollup on disk; undeclared dirs need a rollup.
    results = [...dirs]
      .filter((d) => scheduledOut.has(d) || existsSync(join(root, d, 'rollup.json')))
      .sort()
      .map((d) => checkOne(join(root, d, 'rollup.json'), d, { scheduled: scheduledOut.has(d), missingOk: scheduledOut.has(d), rawSink }));
    if (!results.length) { console.error('liveness: no area rollups found — nothing to watch'); process.exit(1); }
  }

  let worst = 0;
  for (const r of results) {
    worst = Math.max(worst, RANK[r.state] ?? 3);
    // `degraded` reports on stdout: it fires by construction for per-area agents, and a nightly
    // non-empty .err beside every agent is the anti-signal that trains readers past a real one.
    const alarming = (RANK[r.state] ?? 3) >= 1 && r.state !== 'degraded';
    (alarming ? console.error : console.log)(r.line);
  }
  // ── GATE VERDICT JOURNALS, repo-level (C19) ───────────────────────────────────────────────────
  // A baseline stamped after the journal's last record is evidence being lost — rank 3.
  // absent-not-running stays rank 0 (gates deliberately unwired); unreadable is rank 3.
  try {
    // RANK ON THE BAND, NOT THE LABEL. A label table with a `?? 3` default would put every new
    // downstream state on the same rank as a FORGED ledger and alarm the whole fleet on arrival.
    // Bands are a closed set of six; labels are open and expected to grow.
    //
    // UNKNOWN RANKS 1, DELIBERATELY. An unrecognised state is not evidence of a critical, and
    // publishing one as a critical is the fabrication the house rules name. Rank 1 keeps it LOUD
    // and visible without failing the nightly gate — the same policy this file already argues for
    // service availability below: "RANK 1, not 3: this warns, it does not fail the nightly gate."
    for (const g of journalHealth()) {
      const b = bandOf(g.state);
      // DOCUMENTED EXCEPTION, PRESERVED ON PURPOSE. `absent-not-running` is epistemically
      // undetermined — hence its band — but gates may be deliberately unwired, and a nightly .err
      // that fires by construction is, in this file's own words two lanes up, "the
      // anti-signal that trains readers past a real one". The BAND still reports it as unknown; only
      // the ALARM is suppressed. Band is what we know; rank is what we do about it, and they are not
      // the same question.
      const r = g.state === 'absent-not-running' ? 0 : b.rank;
      worst = Math.max(worst, r);
      const detail = g.state === 'ok' ? ` (last ${g.lastVerdict ?? '?'} at ${g.lastAt ?? '?'})`
        : g.state === 'stale-baseline-moved' ? ` — baseline ${g.baselineAt}, journal ${g.lastAt ?? 'never'}: a decision was made that the journal never received`
          : g.state === 'unreadable' ? ` (${g.detail})`
            : g.state === 'torn' ? ` (${g.torn} torn line(s))` : '';
      // Label AND band, both, every row: the label is the specific finding, the band is how to read
      // it. `unknown` marks a state no one has classified — never silently folded into a real one.
      const tag = `${g.state} [${b.band}${b.known ? '' : ', unknown'}]`;
      (r >= 1 ? console.error : console.log)(`gate ${g.gate}: ${tag}${detail}`);
    }
  } catch (e) {
    worst = Math.max(worst, 1);
    console.error(`liveness: gate journal lane unavailable (${e.message}) — journal health is UNKNOWN this run, not clean`);
  }
  if (results.length > 1) console.log(`liveness: ${results.length} areas checked · worst=${['ok', 'stale/degraded/never-swept', '', 'expired/unknown/hung'][worst] || 'ok'}`);

  // ── SERVICE AVAILABILITY (D2/L1) ──────────────────────────────────────────────────────────────
  // Sweep freshness says nothing about whether a declared service is answering.
  // Three facts per service — job loaded, port listening, HTTP answering — because they fail
  // independently and a single boolean hides two of them.
  //
  // RANK 1, not 3: this warns, it does not fail the nightly gate. A service that is down is not a
  // reason to fail a run whose job is to report, and an availability alarm that also breaks the
  // sweep would be switched off within a week.
  let svc = null;
  try {
    const { inventory } = await import('./host-inventory.mjs');
    const { loadRegistry } = await import('./registry.mjs');
    let inv = null;
    // An inventory that THREW is {ok:false} with its reason, never null — portListening reads that
    // as UNKNOWN for every service rather than asserting nothing is bound.
    try { inv = inventory(); } catch (e) { inv = { ok: false, reason: e && e.message }; }
    svc = await serviceHealth({ reg: loadRegistry({ quiet: true }), inv });
    for (const r of svc.rows) {
      const bad = r.state !== 'ok';
      if (bad) worst = Math.max(worst, 1);
      (bad ? console.error : console.log)(`service ${r.area}: ${r.state}${bad ? ` — ${r.reasons.join(' · ')}` : ''}`);
    }
  } catch (e) {
    // A lane that could not run is UNKNOWN, and unknown is worth one rank — never silence.
    worst = Math.max(worst, 1);
    console.error(`liveness: the service lane could not run (${e.message}) — availability is UNKNOWN this run, not ok`);
  }

  // ── THE WATCHER'S OWN PULSE (D2/L3) ───────────────────────────────────────────────────────────
  // A gap in this gate's own journal means it stopped running and started again. readJournal, not
  // readJournalFile: the rotation-aware reader, or a rotation manufactures a false gap.
  let pulse = null;
  try {
    pulse = watcherPulse({ readJournalImpl: (g) => readJournal(g), gate: 'liveness' });
    if (pulse.state === 'gap' || pulse.state === 'unreadable') { worst = Math.max(worst, 1); console.error(`liveness pulse: ${pulse.how}`); }
    else console.log(`liveness pulse: ${pulse.state}${pulse.lastAt ? ` (last ${pulse.lastAt})` : ''}`);
  } catch (e) { console.error(`liveness: own-pulse check failed (${e.message})`); }

  // ── THE DEADMAN KEEPS ITS OWN PULSE ───────────────────────────────────────────────────────────
  // `verdict` is the worst state observed (RANK vocabulary). A clean verdict is still a decision
  // and is recorded — recording only alarms leaves the quiet readings unexamined.
  const stateTally = {};
  for (const r of results) stateTally[r.state] = (stateTally[r.state] || 0) + 1;
  const worstState = results.reduce(
    (acc, r) => ((RANK[r.state] ?? 3) > (RANK[acc] ?? -1) ? r.state : acc),
    results.length ? results[0].state : 'unknown',
  );
  const w = journal('liveness', {
    headSha: headSha(),
    // measured.ok is NOT the verdict — it says only that the sources were read; the alarm lives
    // in `verdict`. Unreadable rollups contribute their failure code so blindness has a fingerprint.
    measured: measuredFromArtifact(explicit || areaSnapshot().reportsRoot, rawSink.length ? rawSink.join('\x1e') : null),
    verdict: worstState,
    worstRank: worst,
    areas: results.length,
    states: stateTally,
    mode: explicit ? 'single-area' : 'fan-out',
    services: svc ? { checked: svc.checked, counts: svc.counts } : null,
    pulse: pulse ? { state: pulse.state, gapMs: pulse.gapMs } : null,
    exit: worst >= 3 ? 1 : 0,
  });
  // A journal failure costs evidence, never a verdict — and it is said out loud.
  if (!w.ok) console.error(`liveness: verdict journal write failed (${w.error}) — decisions are not being recorded`);

  process.exit(worst >= 3 ? 1 : 0);
}
