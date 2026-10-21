// monitor/detection-score.mjs — grades the D1 reducer's classifications against the labelled corpus
// and applies the pre-committed falsification thresholds.
//
// This module is ALLOWED to name the labelled sets ("lob", "heldout") and the source defects — it is
// the GRADER, working against ground truth. The reducer (monitor/detection-reducer.mjs) is the part
// that must stay detector-agnostic; keeping the two in separate files makes that boundary a fact a
// test can check over a whole file rather than a slice of one.

// A finding is "collapsed" under one of three per-item metrics, chosen by its collapseMode:
//   strict → classified 'false-positive' (we KNOW it is false from the content: a test identifier, a
//            descriptive capability). Used where the text alone is decisive (TruffleHog Lob, GuardDog).
//   weak   → classified anything EXCEPT 'real' — the non-fabrication metric (explicit uncertainty). Used where the
//            finding is context-poor and 'needs-human' is the honest answer (Prowler's absent field).
//   survive→ (positive control) classified anything EXCEPT 'false-positive'. A real secret the reducer
//            must NOT silently dismiss — the reject-all guard.
export function isCorrect(item, classification) {
  switch (item.collapseMode) {
    case 'strict': return classification === 'false-positive';
    case 'weak': return classification !== 'real';
    case 'survive': return classification !== 'false-positive';
    default: return false;
  }
}

// Pre-committed FALSIFICATION THRESHOLDS. Below these the D lane is declared not-working and D1 is not
// shipped (spec: "A reducer that does not reproduce the known answer is not shipped").
export const THRESHOLDS = {
  lobStrict: 0.95,      // primary labelled set (TruffleHog Lob): ≥95% must collapse to false-positive
  heldoutNonFab: 0.90,  // held-out DIFFERENT defects (GuardDog capability, Prowler field): ≥90% correctly reduced, detector-agnostic
  positiveSurvive: 1.0, // reals: 100% must survive (0 dismissed as false-positive) — the reject-all guard
  maxErrorRate: 0.10,   // >10% unreadable verdicts ⇒ fail closed (grey is not a pass)
};

// results: array of { item, ok, classification?, error? } aligned to the corpus.
export function scoreRun(results) {
  const buckets = { lob: [], heldout: [], positive: [], other: [] };
  let errors = 0; const total = results.length;
  for (const r of results) {
    if (!r.ok) { errors++; continue; } // an error is NEVER scored as a collapse — it flatters the rate
    const it = r.item;
    const which = it.set === 'lob' ? 'lob' : it.set === 'heldout' ? 'heldout' : it.collapseMode === 'survive' ? 'positive' : 'other';
    buckets[which].push({ item: it, classification: r.classification, correct: isCorrect(it, r.classification) });
  }
  const rate = (arr) => arr.length ? arr.filter((x) => x.correct).length / arr.length : null; // empty ⇒ null (UNKNOWN)
  return {
    total, errors, errorRate: total ? errors / total : 0,
    lob: { n: buckets.lob.length, rate: rate(buckets.lob) },
    heldout: { n: buckets.heldout.length, rate: rate(buckets.heldout) },
    positive: { n: buckets.positive.length, rate: rate(buckets.positive),
      dismissed: buckets.positive.filter((x) => x.classification === 'false-positive').map((x) => x.item.id) },
    buckets,
  };
}

// Apply the thresholds. A null rate (nothing scored in a class) is UNKNOWN and FAILS its gate — a gate
// with nothing behind it never passes (explicit uncertainty).
export function evaluateGates(scored, thresholds = THRESHOLDS) {
  const gate = (name, actual, cmp) => ({ name, actual, pass: actual !== null && cmp(actual) });
  const gates = [
    gate('lob-strict-collapse', scored.lob.rate, (r) => r >= thresholds.lobStrict),
    gate('heldout-non-fabrication', scored.heldout.rate, (r) => r >= thresholds.heldoutNonFab),
    gate('positive-control-survival', scored.positive.rate, (r) => r >= thresholds.positiveSurvive),
    gate('error-rate-fail-closed', scored.errorRate, (r) => r <= thresholds.maxErrorRate),
  ];
  const pass = gates.every((g) => g.pass);
  return { pass, gates, thresholds, verdict: pass ? 'D1 REDUCER WORKS — ship' : 'D1 REDUCER NOT WORKING — do not ship the D lane' };
}
