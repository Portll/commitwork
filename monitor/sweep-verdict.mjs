// commitwork monitor — sweep-verdict: the sweep's per-area and fleet verdict records, pure.
// Everything here lands under reports/, served over a tunnel — records are STRUCTURED FIELDS
// ONLY, sanitized by construction (paths relativized, session/pid keys dropped).
// A step outcome the sweep never supplied is written 'unknown', never omitted.

// ── PER-ITEM STATUS (registry K7 / WP2) ──────────────────────────────────────────────────────
// A loop over N repos used to collapse to one exit status, with per-item failure representable
// only in text nobody parses: 29 area sweeps threw inside their own verdict writer, exited 0 each,
// and every lane read `absent` for a day (2026-08-11). Two things carry the status now: one outcome
// record per scanned repo in the area verdict, and an exit code that names what did not run.
//
// `ran` is decided by commitwork's OWN two outcomes. It exits 0 clean and 1 with findings — both
// are a scan that happened. 2 is its refusal before scanning; null is a signal or a spawn failure.
// A finding is not a failure of the sweep, and a crash is not a finding; the exit code is the one
// place that tells them apart, and it was being swallowed for both.

/** One scanned repo → { name, manifest, code, ran, why }. */
export function scanOutcome({ name, manifest = null, code, signal = null, error = null }) {
  const c = code === undefined ? null : code;
  const ran = c === 0 || c === 1;
  let why;
  if (ran) why = c === 0 ? 'clean' : 'findings';
  else if (error) why = `spawn failed: ${error}`;
  else if (signal) why = `killed by ${signal}`;
  else if (c === 2) why = 'commitwork refused before scanning (exit 2)';
  else why = `exit ${c === null ? 'null' : c} — not a scan outcome`;
  return { name, manifest, code: c, ran, why };
}

/**
 * The area sweep's exit and its ONE summary line. Non-zero when any scan did not run or the
 * sweep's own verdict was not recorded — the two shapes K7 measured. Failed finalize STEPS are
 * already per-item in the verdict record and are summarised here without moving the exit: a
 * sweep that went red on every stale learning view would be switched off within a fortnight (A4).
 */
export function sweepExit({ scans = [], verdictRecorded = true, failedSteps = [] } = {}) {
  const notRan = scans.filter((s) => !s.ran).map((s) => `${s.name}${s.manifest ? ` (${s.manifest})` : ''}: ${s.why}`);
  const parts = [];
  if (notRan.length) parts.push(`${notRan.length} of ${scans.length} scan(s) did NOT run — ${notRan.join('; ')}`);
  if (!verdictRecorded) parts.push('this slice\'s verdict was NOT recorded');
  if (failedSteps.length) parts.push(`${failedSteps.length} finalize step(s) failed (recorded per step, exit unchanged): ${failedSteps.join(', ')}`);
  const exit = notRan.length || !verdictRecorded ? 1 : 0;
  return { exit, notRan, line: parts.length ? parts.join(' · ') : `all ${scans.length} scan(s) ran and the verdict is recorded` };
}

/** rollup.mjs exit -> closed outcome enum: 2 refused-empty, 3 lock-contention, 4 nothing-to-roll-up. */
export function rollupOutcome(status) {
  if (status === null || status === undefined || status === 0) return 'published';
  if (status === 2) return 'refused-empty';
  if (status === 3) return 'lock-contention';
  if (status === 4) return 'nothing-to-roll-up';
  return `failed:${status}`;
}

/** Deep-sanitize a served value: relativize absolute paths under root, drop session/pid keys. */
export function sanitizeServed(value, root) {
  if (typeof value === 'string') {
    return root && value.startsWith(`${root}/`) ? value.slice(root.length + 1) : value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeServed(v, root));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'session' || k === 'pid') continue;
      out[k] = sanitizeServed(v, root);
    }
    return out;
  }
  return value;
}

/**
 * Throw on any served-safety violation: absolute-path VALUES or session/pid keys at any depth.
 * Tests pin the builders with this; the builders sanitize rather than throw.
 */
export function assertServedSafe(record) {
  const walk = (v, path) => {
    if (typeof v === 'string' && v.startsWith('/')) throw new Error(`absolute path at ${path}: ${v}`);
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'session' || k === 'pid') throw new Error(`forbidden key "${k}" at ${path}`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(record, '$');
  return true;
}

// ── THE GATE'S OWN ERROR RATE (roadmap W1) ───────────────────────────────────────────────────
// The canary harness plants known states and scores the real gates against them. Each rate divides
// by the stratum that could exhibit it, as bin/lib/verdict-journal-core.mjs does: false-clean over
// the scenarios the gate called clean, false-alarm over the ones it alarmed on. An empty stratum is
// `not-measured` with rate null — a 0/0 printed as 0% is the false clean this field exists to end.
const CANARY_NOT_RUN = {
  skipped: 'the canary was switched off for this sweep (CW_SWEEP_NO_CANARY=1)',
  child: 'fleet child — the canary runs once per standalone area sweep, not inside a fan-out',
  fleet: 'the fleet parent does not run the canary; each scheduled area sweep records its own',
};
const canaryRate = (n, of) => (of > 0
  ? { state: 'measured', n, of, rate: n / of }
  : { state: 'not-measured', n: 0, of: 0, rate: null, why: 'no scenario in this stratum was scored' });

/** Canary harness output ({exit, summary, results}) or a not-run reason → the verdict's `canary` field. */
export function canaryVerdict(input) {
  if (typeof input === 'string') {
    if (input === 'failed') return { state: 'failed', why: 'the canary harness failed or its output was unreadable' };
    return { state: 'not-measured', why: CANARY_NOT_RUN[input] || `not run (${input})` };
  }
  if (!input || typeof input !== 'object') return { state: 'not-measured', why: 'the sweep supplied no canary result' };
  const { summary, results } = input;
  if (!summary || !Array.isArray(results)) {
    return { state: 'failed', why: 'the canary output carried no per-scenario results, so no rate can be computed' };
  }
  const n = (t) => results.filter((r) => r && !r.skipped && r.truth === t).length;
  const said = { clean: n('true-clean') + n('false-clean'), alarm: n('true-alarm') + n('false-alarm') };
  const scored = said.clean + said.alarm;
  const requiredSkipped = Array.isArray(summary.requiredSkipped) ? summary.requiredSkipped : [];
  return {
    state: scored > 0 ? 'measured' : 'not-measured',
    ...(scored > 0 ? {} : { why: 'the harness ran but scored no scenario' }),
    exit: typeof input.exit === 'number' ? input.exit : null,
    scored, skipped: results.filter((r) => r && r.skipped).length,
    falseClean: canaryRate(n('false-clean'), said.clean),
    falseAlarm: canaryRate(n('false-alarm'), said.alarm),
    ...(summary.attributionScored ? { attribution: { scored: summary.attributionScored, wrong: summary.attributionWrong || 0 } } : {}),
    requiredSkipped,
  };
}

/** The per-area (or scoped single-area) verdict — pairs with batch-manifest.json: intent before, verdict after. */
export function buildAreaVerdict({
  sliceId, area, group, sweptAll, repos, rollup, inflightCleared,
  issues, preflight, hostInventory, races, memoryExport, steps, finalize, canary,
  startedAt, finishedAt, durationSecs,
}, { root } = {}) {
  return sanitizeServed({
    v: 1, kind: 'sweep-area-verdict', at: finishedAt,
    sliceId, area, group, sweptAll: !!sweptAll,
    repos: repos ?? 'unknown',
    rollup: rollup ?? 'unknown',
    inflightCleared: inflightCleared ?? 'unknown',
    issues: issues ?? 'unknown',
    preflight: preflight ?? 'unknown',
    hostInventory: hostInventory ?? 'unknown',
    races: races ?? 'unknown',
    // The memory-layer export exits 0 on every outcome, so this field is the only place the slice
    // records whether its records were actually written (monitor/memory-export-health.mjs).
    memoryExport: memoryExport ?? 'unknown',
    canary: canaryVerdict(canary),
    steps: steps ?? {},
    ...(finalize ? { finalize } : {}),
    startedAt, finishedAt, durationSecs,
  }, root);
}

/** The fleet (--all) verdict: one record per fleet run, areas as measured by the parent. */
export function buildFleetVerdict({ stamp, group, jobs, areas, finalize, clean, exit, startedAt, finishedAt }, { root } = {}) {
  return sanitizeServed({
    v: 1, kind: 'sweep-fleet-verdict', at: finishedAt,
    stamp, group, jobs,
    areas: areas ?? [],
    finalize: finalize ?? {},
    canary: canaryVerdict('fleet'),
    clean: clean ?? 'unknown',
    exit,
    startedAt, finishedAt,
  }, root);
}
