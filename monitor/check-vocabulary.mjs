// ── THE TWO VOCABULARIES A CHECK IS DESCRIBED WITH ───────────────────────────────────────────────
// Different axes, kept apart — collapsing them flattens a severity gradation into a boolean.
//   CHECK_STATUS — what the RUNNER concluded: pass | fail | skip (correct exclusion) |
//                  noscan (ran, produced nothing trustworthy — a VOID, never a pass)
//   SEVERITY     — what the FINDINGS amount to: ok | med | high | skip | noscan
// `skip` and `noscan` appear on BOTH axes deliberately. Lane COVERAGE (full|reduced|unknown) is a
// third axis, living with laneCoverage() in bin/commitwork.mjs. Distinct from
// monitor/schema/status-enum.json — that is the findings-triage vocabulary, a different layer.

/** What the runner concluded about executing a check. */
export const CHECK_STATUS = Object.freeze(['pass', 'fail', 'skip', 'noscan']);

/** What the findings in a check's report amount to. */
export const SEVERITY = Object.freeze(['ok', 'med', 'high', 'skip', 'noscan']);

/**
 * Statuses that mean "this check did not produce a trustworthy result".
 * `skip` is NOT here: a check that correctly did not apply is not a gap.
 */
export const VOID_STATUS = Object.freeze(['noscan']);

const STATUS_SET = new Set(CHECK_STATUS);
const SEVERITY_SET = new Set(SEVERITY);

export const isCheckStatus = (s) => STATUS_SET.has(s);
export const isSeverity = (s) => SEVERITY_SET.has(s);

/** Normalise the runner's internal `skipped` to the wire's `skip` — the wire never carries `skipped`. */
export const toWireStatus = (s) => (s === 'skipped' ? 'skip' : s);
