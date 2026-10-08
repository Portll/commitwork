// divergence.mjs — the divergence index (WORKLIST D3). Two offset agents render the SAME decision
// surface (a triage-verdict); this scores their DISAGREEMENT per subject in [0,1] and records it into
// the nondeterministic store (recorded-not-recomputed). It publishes ONLY the disagreement — a pointer
// to where a human should look, never a verdict, never a severity.
//
// fact: classifications are {real, false-positive, intentional, needs-human}. agree=0; needs-human vs a
// decided pole = 0.5 (adjacent); real vs false-positive = 1 (opposed).
// fact: a low score between MEASURED-CORRELATED lenses is DISCOUNTED — agreement is evidence only to the
// degree the two could have disagreed, so correlation erodes the (1-score) "agreement" portion.
// fact: one side absent ⇒ score is NULL (undefined) — never 0 (agree), never 1 (disagree). The icon
// renders that as grey, distinct from a measured 0.00 which is green.

import { record } from './nondeterministic-store.mjs';

// Declared weighting — auditable and versioned, never hard-coded at the call site.
export const WEIGHTS = Object.freeze({ perFinding: 0.7, verdictMismatch: 0.2, coveragePenalty: 0.1 });

const DECIDED = new Set(['real', 'false-positive', 'intentional']);
function pairDistance(a, b) {
  if (a === b) return 0;
  if (a === 'needs-human' || b === 'needs-human') return 0.5; // undecided vs decided — adjacent
  if (DECIDED.has(a) && DECIDED.has(b)) return 1;             // two decided poles that disagree — opposed
  return 0.5;                                                 // an unknown class pairing — adjacent, never 0
}

const byId = (v) => new Map((v.findings || []).filter((f) => f && f.id).map((f) => [f.id, f.classification]));

// Score two triage-verdict objects. correlation ∈ [0,1] is the measured lens correlation (§F).
export function divergenceScore(verdictA, verdictB, { correlation = 0 } = {}) {
  if (!verdictA || !verdictB) return { score: null, why: 'one side absent — undefined, not 0 and not 1' };
  const A = byId(verdictA), B = byId(verdictB);
  const both = [...A.keys()].filter((id) => B.has(id));
  const onlyOne = [...A.keys()].filter((id) => !B.has(id)).length + [...B.keys()].filter((id) => !A.has(id)).length;
  const total = new Set([...A.keys(), ...B.keys()]).size || 1;

  const perFinding = both.length
    ? both.reduce((s, id) => s + pairDistance(A.get(id), B.get(id)), 0) / both.length
    : (onlyOne ? 1 : 0); // no shared findings but disjoint sets ⇒ maximal per-finding disagreement
  const verdictMismatch = verdictA.verdict === verdictB.verdict ? 0 : 1;
  const coveragePenalty = onlyOne / total; // a finding only ONE agent named is itself disagreement

  const base = WEIGHTS.perFinding * perFinding + WEIGHTS.verdictMismatch * verdictMismatch + WEIGHTS.coveragePenalty * coveragePenalty;
  // Correlated-agreement discount: divergence is at least `base`, and correlation erodes the agreement
  // portion (1-base). corr=0 ⇒ unchanged; corr=1 ⇒ the agreement is fully discounted.
  const score = 1 - (1 - Math.max(0, Math.min(1, base))) * (1 - Math.max(0, Math.min(1, correlation)));
  return {
    score: Number(score.toFixed(4)),
    components: { perFinding: Number(perFinding.toFixed(4)), verdictMismatch, coveragePenalty: Number(coveragePenalty.toFixed(4)) },
    coverage: { both: both.length, onlyOne, total }, correlation,
  };
}

// Score AND record into the SEPARATE nondeterministic store (never the deterministic rollup). A null
// score (one side absent) records nothing — it is grey, not a number.
export function recordDivergence({ subject, verdictA, verdictB, correlation = 0, detail = null } = {}) {
  if (!subject) throw new Error('recordDivergence: subject is required');
  const r = divergenceScore(verdictA, verdictB, { correlation });
  if (r.score === null) return { ...r, recorded: false };
  record({ subject, dimension: 'divergence', score: r.score, detail: detail || { components: r.components, coverage: r.coverage, correlation } });
  return { ...r, recorded: true };
}
