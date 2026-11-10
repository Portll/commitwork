// lib/judge-taxonomy.mjs — the fixed scales the orchestrator classifies every finding on.
// Three independent axes: SEVERITY (how bad if true), URGENCY (how soon it must move), SIZE (fix
// effort). Each is a closed ordinal set; a value that does not normalise becomes `undetermined`,
// which is its OWN rank, never silently folded into `low`/`medium` (house rule: unknown is a state).

export const SEVERITY = Object.freeze(['crit', 'high', 'med', 'low']);
export const URGENCY = Object.freeze(['crit', 'high', 'med', 'low']);
export const SIZE = Object.freeze(['XS', 'S', 'M', 'L', 'XL']);
export const UNDETERMINED = 'undetermined';

const SEV_ALIASES = Object.freeze({
  critical: 'crit', crit: 'crit', c: 'crit',
  high: 'high', h: 'high', error: 'high',
  medium: 'med', med: 'med', m: 'med', moderate: 'med', warning: 'med',
  low: 'low', l: 'low', info: 'low', informational: 'low', note: 'low', none: 'low',
});
const SIZE_ALIASES = Object.freeze({
  xs: 'XS', s: 'S', small: 'S', m: 'M', medium: 'M', l: 'L', large: 'L', xl: 'XL', 'x-large': 'XL',
});

const clean = (v) => String(v ?? '').trim().toLowerCase();

/** A CVSS-style 0–10 score → severity bucket. NaN / out of range → null (caller decides fallback). */
export function severityFromScore(score) {
  // Number(null)/Number('')/Number(false) all coerce to 0 — a VALID score — so reject non-numeric
  // inputs before coercion, or a null severity would read as `low`.
  if (score === null || score === undefined || score === '' || typeof score === 'boolean') return null;
  const n = Number(score);
  if (!Number.isFinite(n) || n < 0 || n > 10) return null;
  if (n >= 9) return 'crit';
  if (n >= 7) return 'high';
  if (n >= 4) return 'med';
  return 'low';
}

/** Normalise any severity-shaped input to the SEVERITY scale, else `undetermined`. */
export function normSeverity(value) {
  const byScore = severityFromScore(value);
  if (byScore) return byScore;
  return SEV_ALIASES[clean(value)] || UNDETERMINED;
}

/** Urgency shares the severity vocabulary; kept separate so the two axes can diverge. */
export function normUrgency(value) {
  return SEV_ALIASES[clean(value)] || UNDETERMINED;
}

export function normSize(value) {
  const c = clean(value);
  return SIZE_ALIASES[c] || (SIZE.includes(String(value)) ? String(value) : UNDETERMINED);
}

// Remediation rank: smaller sorts first. severity dominates, urgency breaks ties, then smaller fixes
// first (fast wins before slow ones at equal risk). `undetermined` on either risk axis sorts AFTER
// every known bucket — an unclassified finding is triaged, never actioned ahead of a known crit.
const sevRank = (s) => { const i = SEVERITY.indexOf(s); return i < 0 ? SEVERITY.length : i; };
const sizeRank = (s) => { const i = SIZE.indexOf(s); return i < 0 ? SIZE.length : i; };

export function priorityKey({ severity, urgency, size }) {
  return [sevRank(normSeverity(severity)), sevRank(normUrgency(urgency)), sizeRank(normSize(size))];
}

/** Order a list of {severity,urgency,size,...} by priorityKey, stable within equal keys. */
export function byPriority(findings) {
  return findings
    .map((f, i) => ({ f, i, k: priorityKey(f) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.i - b.i)
    .map((x) => x.f);
}

/** Classify one finding onto all three axes at once; every axis is explicit, none inferred silently. */
export function classify({ severity = null, urgency = null, size = null, score = null } = {}) {
  return {
    severity: normSeverity(severity ?? score),
    urgency: normUrgency(urgency ?? severity ?? score),
    size: normSize(size),
  };
}
