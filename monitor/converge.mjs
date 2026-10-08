// converge.mjs — the specificity mechanism (WORKLIST lane F). A finding publishes at SEVERITY only
// where INDEPENDENT lenses converge; a single lens caps at undetermined. The gate scales INVERSE to
// oracle strength: a mechanical oracle (tier 1) publishes alone; an anomaly (tier 2) needs a second
// independent one; an inference lens (tier 3) needs convergence.
//
// fact: "exempt from convergence" is NOT "exempt from verification" — a tier-1 candidate must carry an
// oracle-integrity pass (A: positive-control+canary+consent; B: declared-not-inferred). Without it it
// is REFUSED, never published — the backstop for the one tier that has no second witness.
// fact: two lenses that share THIS subject's PROVENANCE are ONE lens for it — model family does not
// make them independent, and correlated agreement is not convergence.
// fact: cross-tier (inference + oracle/anomaly) beats same-tier inference×inference — two LLMs can agree
// from shared pretraining, so their agreement is the WEAKEST convergence and is discounted.
// fact: the AND rule buys specificity with a FALSE-NEGATIVE floor — a lone true finding is demoted to
// undetermined. That trade is correct ONLY for the inference tier; it is stated, never hidden.

// A candidate: { tier: 1|2|3, lens: string, provenance?: string, oracleIntegrity?: boolean }
// Independent witnesses = distinct provenance. No provenance ⇒ the lens is its own (weakest assumption).
function independentWitnesses(candidates) {
  const byProvenance = new Map();
  for (const c of candidates) {
    const key = c.provenance || c.lens;
    if (!byProvenance.has(key)) byProvenance.set(key, c); // first wins; the rest collapse into it
  }
  return [...byProvenance.values()];
}

const tiersOf = (ws) => new Set(ws.map((w) => w.tier));

// Decide what a subject publishes given its candidates. Returns
//   { subject, publish: 'severity'|'undetermined'|'refused-then-undetermined', witnesses, why }
export function converge({ subject, candidates = [] } = {}) {
  if (!subject) throw new Error('converge: subject is required');
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { subject, publish: 'undetermined', witnesses: [], why: 'no candidates — undetermined, never clean' };
  }
  const witnesses = independentWitnesses(candidates);

  // TIER 1 — ground truth publishes ALONE, but ONLY with oracle-integrity.
  const tier1 = witnesses.filter((w) => w.tier === 1);
  const tier1ok = tier1.find((w) => w.oracleIntegrity === true);
  if (tier1ok) {
    return { subject, publish: 'severity', witnesses: [tier1ok],
      why: `tier-1 oracle (${tier1ok.lens}) passed oracle-integrity — publishes alone, converges with nothing` };
  }
  const tier1refused = tier1.length > 0; // a tier-1 present but none with integrity ⇒ refused, fall through

  // ≥2 INDEPENDENT witnesses — convergence is possible.
  if (witnesses.length >= 2) {
    const tiers = tiersOf(witnesses);
    if (tiers.size > 1) {
      return { subject, publish: 'severity', witnesses,
        why: `cross-tier convergence (${witnesses.map((w) => `t${w.tier}:${w.lens}`).join(' + ')}) — a witness of a different KIND, the strongest form` };
    }
    // all the same tier:
    const t = [...tiers][0];
    if (t === 2) {
      return { subject, publish: 'severity', witnesses,
        why: `two independent anomalies (${witnesses.map((w) => w.lens).join(', ')}) — the tier-2 promotion` };
    }
    if (t === 3) {
      return { subject, publish: 'undetermined', witnesses,
        why: 'same-tier inference×inference agreement is discounted (they can agree from shared pretraining) — routes a human, not a severity' };
    }
    // t === 1 here means ≥2 tier-1 candidates, none with integrity: still refused.
    return { subject, publish: 'refused-then-undetermined', witnesses,
      why: 'tier-1 candidates without oracle-integrity are refused, not published — undetermined' };
  }

  // A SINGLE witness — the false-negative floor. A lone lens never reaches severity.
  const lone = witnesses[0];
  if (tier1refused) {
    return { subject, publish: 'refused-then-undetermined', witnesses: [lone],
      why: `tier-1 candidate (${lone.lens}) lacked oracle-integrity and stands alone — refused, undetermined` };
  }
  return { subject, publish: 'undetermined', witnesses: [lone],
    why: `single ${lone.tier === 3 ? 'inference' : `tier-${lone.tier}`} lens (${lone.lens}) — caps at undetermined (F's false-negative floor: a lone true finding is demoted, the price of specificity)` };
}

// Convenience: did this converge to a publishable severity?
export const published = (r) => r.publish === 'severity';
