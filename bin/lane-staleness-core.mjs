// bin/lane-staleness-core.mjs — the DECISIONS, with no I/O. bin/lane-staleness.mjs does the reading.
//
// THE QUESTION NOBODY WAS ASKING. Sibling to bin/spine-reconcile-core.mjs, which asks whether the
// store still holds what the ledger claims. This one asks the cheaper question that also went
// unasked for eight days: has this lane produced ANYTHING lately?
//
// Three lanes failed silently for ~8 days (measured on this box 2026-09-06/07) and no surface went
// red, because every check verified a PROXY for production rather than production:
//   · a dep-scan lane produced 82 consecutive voids. The reason was recorded accurately in
//     reports/sweep-*/batch-manifest.json every single time — images.images[].reason carried
//     "write /var/lib/containerd/.../meta.db: input/output error" — and was never read.
//   · the spine store accepted no filings for 8 days. gate-spine checks the store is READABLE;
//     readable it was, and empty of new arrivals it also was.
//   · an MCP config sat in a file the harness does not read, so a tool was absent fleet-wide.
// Evidence was written down repeatedly and nobody asked the question.
//
// MTIME IS NOT PRODUCTION, AND THIS IS THE LOAD-BEARING DISTINCTION. .claude/store/spine-touches.jsonl
// had mtime 2026-09-06 21:31 while its newest ROW read 2026-08-31T03:20 — six days apart. A
// count-or-mtime delta was read as live activity today. So this module dates a lane by the newest
// record it produced, never by the file that holds them, and when the caller supplies an mtime it
// reports how far AHEAD of the newest record that mtime runs, so the misreading is visible rather
// than merely avoided.
//
// A RUN IS NOT AN OUTPUT. The dep-scan lane was running the whole time. Rows arrived, the file grew,
// every proxy said healthy — and each row said, in its own reason field, that it had produced
// nothing. So a sample carries `productive` separately from its existence, and `voids-only` is its
// own verdict, opposite in diagnosis to `stale`: stale says the scheduler stopped, voids-only says
// the lane ran and failed. Their fixes have nothing in common.
//
// STALE NEEDS A DECLARED CADENCE, AND THIS MODULE WILL NOT INVENT ONE. Without a declared expected
// interval, "nothing arrived since Tuesday" is a measurement, not a verdict — a checker that
// supplies its own expectation reports a fault on ~100% of lanes, which is a defect signature in the
// checker and not a fleet in crisis (CLAUDE.md, grey ≠ red). An undeclared cadence is UNKNOWN, in
// its own bucket, outside every finding count. It does NOT suppress the evidence: last production,
// last activity, row counts and the recorded reasons are reported for a grey lane exactly as for a
// red one, because the grey verdict is about what can be CONCLUDED, never about what was SEEN.
//
// ABSENCE IS NOT A FINDING AND UNREADABLE IS NOT SILENCE. A lane with no evidence path was never
// configured — it cannot evidence that anything stopped. A lane whose evidence path is present and
// will not open is a FAULT, and reporting it as "produced nothing" would invent an outage out of a
// permission bit. Both are grey; neither is green; neither is red.
//
// THIS IS A REPORTER, NOT A GATE. See bin/lane-staleness.mjs for why the exit code is always 0.

/**
 * The verdicts. Eight, because each one has a different next action, and because the four a proxy
 * check collapses into "fine" are the four this module exists to separate.
 */
export const LANE_ABSENT = 'lane-absent';               // no evidence path — UNKNOWN, never a finding
export const LANE_UNREADABLE = 'lane-unreadable';       // path present, would not open — a FAULT, not silence
export const CLOCK_UNREADABLE = 'clock-unreadable';     // output exists, no record carries a usable time
export const NEVER_PRODUCED = 'never-produced';         // path readable and has never held output
export const VOIDS_ONLY = 'voids-only';                 // records arrived; not one of them was an output
export const CADENCE_UNDECLARED = 'cadence-undeclared'; // producing, but "late" is undefined here — UNKNOWN
export const PRODUCING = 'producing';                   // output inside the declared cadence
export const STALE = 'stale';                           // cadence declared and nothing arrived within it

/**
 * DISPLAY ORDER ONLY — never severity, and never a bucket.
 *
 * Sorting by rank puts a grey lane above a green one so a human sees it, and that adjacency is
 * exactly how "displayed near the findings" turns into "counted with the findings" three readers
 * later. The finding / fault / unknown split lives in `grey` and `fault` and in rollup()'s buckets;
 * position in a list carries no verdict.
 */
export const RANK = {
  [STALE]: 7,
  [VOIDS_ONLY]: 6,
  [LANE_UNREADABLE]: 5,
  [CLOCK_UNREADABLE]: 5,
  [NEVER_PRODUCED]: 4,
  [CADENCE_UNDECLARED]: 2,
  [LANE_ABSENT]: 1,
  [PRODUCING]: 0,
};

/** Verdicts that assert a lane is not producing. Everything else is either fine or undetermined. */
export const FINDINGS = new Set([STALE, VOIDS_ONLY, NEVER_PRODUCED]);
/** Verdicts that assert the sensor is broken — a fault about the CHECK, not about the lane. */
export const FAULTS = new Set([LANE_UNREADABLE, CLOCK_UNREADABLE]);
/** Verdicts that assert nothing at all. Not green, not red. */
export const UNKNOWNS = new Set([LANE_ABSENT, CADENCE_UNDECLARED]);

const HOUR_MS = 60 * 60 * 1000;

/**
 * Epoch ms for a sample's clock, or null.
 *
 * Accepts an ISO string or an epoch-ms number, because a JSONL ledger and a SQLite column disagree
 * about which one they store and neither is wrong. An unusable clock costs the TIMESTAMP, never the
 * row: the record still counts as activity, it simply cannot date anything.
 */
export function sampleMs(s) {
  if (s == null) return null;
  const v = typeof s === 'object' ? s.at : s;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim()) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Is this record an OUTPUT, or merely a run that happened?
 *
 * Default true: a lane that does not distinguish the two has every record counted as output, which
 * is the honest reading of a store that never recorded the difference. Only an explicit `false`
 * makes a record a void — an ABSENT field must never be read as a void, or a schema this module
 * does not understand would be published as 82 failures.
 */
export const isProductive = (s) => !(s && typeof s === 'object' && s.productive === false);

/** The verbatim recorded explanation for a void, or null. Never paraphrased; the point is that it was already written down. */
export const reasonOf = (s) => (s && typeof s === 'object' && typeof s.reason === 'string' && s.reason.trim() ? s.reason : null);

/** "8d 4h" / "3h" / "12m". Pure and deterministic; used by the CLI so ages read the same everywhere. */
export function humanAge(ms) {
  if (!Number.isFinite(ms)) return 'unknown';
  const neg = ms < 0;
  const t = Math.abs(ms);
  const d = Math.floor(t / 86400000);
  const h = Math.floor((t % 86400000) / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return neg ? `-${s}` : s;
}

const iso = (ms) => (ms === null ? null : new Date(ms).toISOString());

/** Group the recorded void reasons, worst first, ties by text so ordering never depends on insertion. */
function tallyReasons(samples) {
  const counts = new Map();
  for (const s of samples) {
    if (isProductive(s)) continue;
    const r = reasonOf(s) || '(no reason recorded)';
    counts.set(r, (counts.get(r) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/**
 * Assess one lane. Pure: every input is already-read data — no fs, no env, no clock.
 *
 * @param name      {string}  the lane's name, as declared
 * @param kind      {string}  'jsonl' | 'sqlite' | whatever the reader called itself; carried, not interpreted
 * @param path      {string}  the evidence path that was read — printed in every report, because a
 *                            number nobody can re-derive is a number nobody re-checks
 * @param present   {boolean} does the evidence path exist? false ONLY for a stat() ENOENT
 * @param samples   {Array|null} records the lane produced; null = present but UNREADABLE, [] = readable and empty.
 *                            Each: { at: ISO|epochMs, productive?: boolean, reason?: string }
 * @param cadenceMs {number|null} the DECLARED expected interval. null/absent/<=0 ⇒ undeclared, and
 *                            this module will not substitute one.
 * @param graceMs   {number}  declared slack on top of the cadence. Defaults to 0 — a default grace
 *                            is an invented interval wearing a smaller hat.
 * @param now       {number}  epoch ms, caller-supplied so CW_NOW keeps this deterministic
 * @param mtimeMs   {number|null} the evidence FILE's mtime, if the reader has one. Reported, never
 *                            used to date production. See the header.
 * @param why       {string|null} the reader's verbatim explanation of an unreadable path
 * @param skipped   {number}  records the reader could not parse — counted, never silently dropped
 */
export function assessLane({
  name, kind = 'unknown', path = null, present = true, samples = null,
  cadenceMs = null, graceMs = 0, now, mtimeMs = null, why = null, skipped = 0,
}) {
  const cadence = Number.isFinite(cadenceMs) && cadenceMs > 0 ? cadenceMs : null;
  const grace = Number.isFinite(graceMs) && graceMs > 0 ? graceMs : 0;
  const nowMs = Number.isFinite(now) ? now : null;

  const base = {
    name, kind, path, verdict: null, grey: false, fault: false, block: false, detail: '',
    rows: null, productiveRows: null, voidRows: null, skipped,
    lastProduction: null, lastActivity: null, ageMs: null, ageHours: null,
    cadenceMs: cadence, graceMs: grace, overdueMs: null,
    mtime: iso(Number.isFinite(mtimeMs) ? mtimeMs : null), mtimeAheadOfNewestMs: null,
    reasons: [], why,
  };

  // Order matters, and it is the same order as spine-reconcile: absence before readability, both
  // before any counting. A path that is not there cannot be unreadable, and neither can be stale.
  if (!present) {
    return {
      ...base, verdict: LANE_ABSENT, grey: true,
      detail: `no evidence path for lane "${name}" — it was never configured here, or its output has `
        + 'never been written. A lane that was never here cannot evidence that anything stopped: '
        + '"not installed" and "stopped producing" are different states and only the second is a fault.',
    };
  }
  if (!Array.isArray(samples)) {
    return {
      ...base, verdict: LANE_UNREADABLE, grey: true, fault: true,
      detail: `lane "${name}" is present and could not be read, so what it has produced is UNKNOWN — `
        + 'not "nothing". Reporting zero here would manufacture an outage out of a permission bit or '
        + 'a corrupt file.',
    };
  }

  const productive = samples.filter(isProductive);
  const voids = samples.length - productive.length;
  const activityMs = samples.reduce((m, s) => {
    const t = sampleMs(s);
    return t !== null && (m === null || t > m) ? t : m;
  }, null);
  const productionMs = productive.reduce((m, s) => {
    const t = sampleMs(s);
    return t !== null && (m === null || t > m) ? t : m;
  }, null);

  const counted = {
    ...base,
    rows: samples.length, productiveRows: productive.length, voidRows: voids,
    lastActivity: iso(activityMs), lastProduction: iso(productionMs),
    reasons: tallyReasons(samples),
    // How far the FILE's clock runs ahead of the newest record it holds. Positive means the proxy a
    // careless check would have used says "today" while the lane's own newest record does not.
    mtimeAheadOfNewestMs: Number.isFinite(mtimeMs) && activityMs !== null ? mtimeMs - activityMs : null,
  };

  if (samples.length === 0) {
    return {
      ...counted, verdict: NEVER_PRODUCED,
      detail: `lane "${name}" is readable and holds no records at all — it has never produced output `
        + 'here. That is a fact about this box, not necessarily a fault: a lane installed an hour ago '
        + 'looks identical. What it is NOT is a clean result.',
    };
  }
  if (productive.length === 0) {
    const top = counted.reasons[0];
    return {
      ...counted, verdict: VOIDS_ONLY,
      detail: `lane "${name}" produced ${samples.length} record(s) and not one of them was an output. `
        + 'The lane RAN — mtime moved, counts grew, every proxy check reads this as healthy — and each '
        + 'run recorded that it produced nothing'
        + (top ? `. Most common recorded reason (${top.count}×), verbatim: ${JSON.stringify(top.reason)}` : '')
        + '. This is the opposite diagnosis from `stale`: the scheduler is alive and the lane is broken.',
    };
  }
  if (productionMs === null) {
    return {
      ...counted, verdict: CLOCK_UNREADABLE, grey: true, fault: true,
      detail: `lane "${name}" holds ${productive.length} output record(s) and not one carries a parseable `
        + 'timestamp, so WHEN it last produced is UNKNOWN. Undatable records must never be read as '
        + 'recent ones — that is a descriptive signal wearing a verdict’s clothes. Fix the record '
        + 'schema before trusting any freshness answer about this lane.',
    };
  }

  const ageMs = nowMs === null ? null : nowMs - productionMs;
  const withAge = { ...counted, ageMs, ageHours: ageMs === null ? null : Math.round(ageMs / HOUR_MS) };

  if (nowMs === null) {
    return {
      ...withAge, verdict: CLOCK_UNREADABLE, grey: true, fault: true,
      detail: `lane "${name}" last produced at ${iso(productionMs)}, but this run has no usable clock, so `
        + 'nothing can be said about how long ago that was. UNKNOWN, not fresh.',
    };
  }

  if (cadence === null) {
    return {
      ...withAge, verdict: CADENCE_UNDECLARED, grey: true,
      detail: `lane "${name}" last produced at ${iso(productionMs)} (${humanAge(ageMs)} ago), and no expected `
        + 'cadence is declared for it, so whether that is LATE is UNKNOWN. This checker will not invent an '
        + 'interval: a fabricated expectation fails ~100% of lanes and that is a defect in the checker, not '
        + 'a fleet in crisis. Declare a cadence for this lane and the same evidence becomes a verdict.',
    };
  }

  const overdueMs = ageMs - (cadence + grace);
  const window = `cadence ${humanAge(cadence)}${grace ? ` + ${humanAge(grace)} grace` : ''}`;
  if (overdueMs <= 0) {
    return {
      ...withAge, verdict: PRODUCING, overdueMs,
      detail: `lane "${name}" last produced ${humanAge(ageMs)} ago, inside its declared ${window}.`
        + (voids ? ` (${voids} of ${samples.length} record(s) were void — output is arriving, but not from every run.)` : ''),
    };
  }
  const sinceProduction = samples.filter((s) => {
    const t = sampleMs(s);
    return t !== null && t > productionMs;
  });
  const voidsSince = sinceProduction.filter((s) => !isProductive(s)).length;
  const top = tallyReasons(sinceProduction)[0];
  return {
    ...withAge, verdict: STALE, overdueMs,
    detail: `lane "${name}" last produced at ${iso(productionMs)} — ${humanAge(ageMs)} ago, overdue by `
      + `${humanAge(overdueMs)} against its declared ${window}.`
      + (sinceProduction.length
        ? ` ${sinceProduction.length} record(s) have arrived since, ${voidsSince} of them void`
          + (top ? `, most common recorded reason (${top.count}×), verbatim: ${JSON.stringify(top.reason)}` : '')
          + '. The lane is running and producing nothing.'
        : ' No records at all have arrived since. The producer looks stopped rather than broken.'),
  };
}

/**
 * Assess a fleet of already-read lanes and order them for a human.
 *
 * Deterministic by construction: rank first, then name. Same lanes in any order ⇒ identical output.
 */
export function assessFleet({ lanes = [], now }) {
  const results = lanes.map((l) => assessLane({ ...l, now }));
  results.sort((a, b) => (RANK[b.verdict] ?? 0) - (RANK[a.verdict] ?? 0) || String(a.name).localeCompare(String(b.name)));
  return { lanes: results, rollup: rollup(results) };
}

/**
 * The counts, in FOUR buckets rather than two.
 *
 * `unknown` and `faults` are outside `findings` on purpose and by house rule: an undetermined lane
 * is not a pass and is not a finding, and folding either way is the failure this repo has now made
 * in both directions. A caller that wants one number must decide which bucket it is claiming.
 */
export function rollup(results) {
  const by = (v) => results.filter((r) => r.verdict === v).length;
  const findings = results.filter((r) => FINDINGS.has(r.verdict)).length;
  const faults = results.filter((r) => FAULTS.has(r.verdict)).length;
  const unknown = results.filter((r) => UNKNOWNS.has(r.verdict)).length;
  return {
    total: results.length,
    producing: by(PRODUCING),
    findings,
    faults,
    unknown,
    byVerdict: {
      [STALE]: by(STALE),
      [VOIDS_ONLY]: by(VOIDS_ONLY),
      [NEVER_PRODUCED]: by(NEVER_PRODUCED),
      [LANE_UNREADABLE]: by(LANE_UNREADABLE),
      [CLOCK_UNREADABLE]: by(CLOCK_UNREADABLE),
      [CADENCE_UNDECLARED]: by(CADENCE_UNDECLARED),
      [LANE_ABSENT]: by(LANE_ABSENT),
      [PRODUCING]: by(PRODUCING),
    },
  };
}

/** One line per lane, for a human. Never collapses grey into either direction. */
export function summarise(r) {
  switch (r.verdict) {
    case LANE_ABSENT: return `${r.name}: absent — UNKNOWN, not a finding`;
    case LANE_UNREADABLE: return `${r.name}: unreadable — a fault, not an empty lane`;
    case CLOCK_UNREADABLE: return `${r.name}: output undatable — UNKNOWN, never "recent"`;
    case NEVER_PRODUCED: return `${r.name}: has never produced output here`;
    case VOIDS_ONLY: return `${r.name}: ${r.rows} run(s), 0 outputs — running and producing nothing`;
    case CADENCE_UNDECLARED: return `${r.name}: last output ${humanAge(r.ageMs)} ago, no cadence declared — UNKNOWN, not stale`;
    case PRODUCING: return `${r.name}: producing, last output ${humanAge(r.ageMs)} ago`;
    case STALE: return `${r.name}: STALE — last output ${humanAge(r.ageMs)} ago, overdue by ${humanAge(r.overdueMs)}`;
    default: return `${r.name}: ${r.verdict}`;
  }
}

/** The fleet headline. Keeps the four buckets separate in prose exactly as rollup() keeps them in numbers. */
export function summariseFleet(ro) {
  if (ro.total === 0) return 'no lanes declared — nothing was checked, which is not a clean result';
  return `${ro.total} lane(s): ${ro.findings} not producing, ${ro.faults} unreadable, `
    + `${ro.unknown} UNKNOWN (neither), ${ro.producing} producing`;
}
