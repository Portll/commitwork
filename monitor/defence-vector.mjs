// monitor/defence-vector.mjs — n-dimensional defence-in-depth vector + residual verdict.
// Containment needs >= QUORUM orthogonal blocking axes. Rules enforced below:
//   D-ORTHO  patchAvailability never counts toward quorum; reachability=blocks voids dataAtRisk;
//            networkExposure+authnAuthz count once when both cite the same control
//   D-PROBE  `inexploitable` needs a live DAST/BOLA probe; reachability never blocks from prose alone
//   D-EXPIRE contained/inexploitable require expires + recheckTrigger; verdict RECOMPUTED, never hand-set
//   D-UNMEASURED  a vector nobody populated yields `undetermined`, never `exploitable` — see below

export const QUORUM = 3;

// The axes that count toward containment (patchAvailability deliberately absent).
export const QUORUM_AXES = [
  'reachability', 'networkExposure', 'authnAuthz',
  'inputMediation', 'privilegeBlast', 'dataAtRisk', 'detectability',
];
export const ALL_AXES = [...QUORUM_AXES, 'patchAvailability'];

// Axes whose block is derivable from prose evidence vs must be probe/computed-backed.
const PROSE_CAPPED = new Set(['reachability']); // reachability=blocks needs computed/DAST, else capped to partial

/**
 * D-UNMEASURED. True when no axis carries a reading: every state is the `open` default AND no
 * axis cites evidence. `open` is the value normAxis() invents for a missing cell, so a vector
 * nobody ever populated is indistinguishable — by state alone — from one measured and found
 * undefended. Those are opposite claims and the fallback below used to publish both as
 * `exploitable`.
 *
 * fix: measured-undefended keeps `exploitable`; never-measured becomes `undetermined`.
 */
export function isUnmeasured(v) {
  return ALL_AXES.every(ax => {
    const c = v[ax] || {};
    return (c.state === undefined || c.state === 'open') && !String(c.evidence || '').trim();
  });
}

/** Normalize one axis cell to {state, evidence, ref, rationale?, who?, at?}. */
function normAxis(cell) {
  const c = cell || {};
  let state = ['blocks', 'partial', 'open', 'n/a'].includes(c.state) ? c.state : 'open';
  return { state, evidence: c.evidence || '', ref: c.ref || '', rationale: c.rationale, who: c.who, at: c.at };
}

/**
 * Compute the defence vector + residual verdict for a record.
 * @param {object} rec  lifecycle record; rec.defenceVector may carry partial per-axis input
 * @returns {{defenceVector:object, residualVerdict:string, quorumMet:number, violations:string[]}}
 */
export function computeDefence(rec) {
  const inRaw = rec.defenceVector || {};
  const v = {};
  for (const ax of ALL_AXES) v[ax] = normAxis(inRaw[ax]);
  const violations = [];
  // Read this off the RAW input: every mutation below is gated on some axis blocking, so it
  // cannot fire on an unmeasured vector — but pinning it here keeps that independent of them.
  const unmeasured = isUnmeasured(inRaw);

  // D-PROBE: reachability may not block from prose. Unless a computed call-graph or a DAST hit
  // backs it (ref names 'dast'/'call-graph'/'dependencyInsight'), cap blocks -> partial.
  const rch = v.reachability;
  if (rch.state === 'blocks' && !/dast|call-?graph|dependencyinsight|unused-dep|compileonly/i.test(rch.ref + ' ' + rch.evidence)) {
    rch.state = 'partial';
    rch.rationale = (rch.rationale ? rch.rationale + '; ' : '') + 'D-PROBE: reachability block downgraded to partial — no computed/DAST evidence (prose-only)';
  }

  // D-ORTHO: reachability=blocks short-circuits dataAtRisk to n/a (dead code exposes no data).
  if (v.reachability.state === 'blocks') {
    v.dataAtRisk = { state: 'n/a', evidence: v.dataAtRisk.evidence, ref: v.dataAtRisk.ref,
      rationale: 'D-ORTHO: reachability blocks => vulnerable path not invoked => dataAtRisk vacuous (not double-counted)' };
  }

  // D-ORTHO: networkExposure + authnAuthz may not both count if both cite the same control (C5/internal-network).
  const netRef = (v.networkExposure.ref + ' ' + v.networkExposure.evidence).toLowerCase();
  const authRef = (v.authnAuthz.ref + ' ' + v.authnAuthz.evidence).toLowerCase();
  const sameControl = /internal-network|c5|localhost|private-subnet/.test(netRef) && /internal-network|c5|localhost|gateway/.test(authRef);
  let dedupNote = null;
  if (sameControl && v.networkExposure.state === 'blocks' && v.authnAuthz.state === 'blocks') {
    dedupNote = 'networkExposure & authnAuthz share the same control — counted once toward quorum (D-ORTHO)';
  }

  // n/a must carry a rationale.
  for (const ax of ALL_AXES) {
    if (v[ax].state === 'n/a' && !v[ax].rationale) violations.push(`axis ${ax} is n/a without rationale`);
  }

  // Quorum = distinct blocking QUORUM_AXES, with the net/auth dedupe.
  let blocking = QUORUM_AXES.filter(ax => v[ax].state === 'blocks');
  if (dedupNote) blocking = blocking.filter((ax, i) => !(ax === 'authnAuthz')); // drop one of the correlated pair
  const quorumMet = blocking.length;

  // Verdict, RECOMPUTED (never hand-set).
  const patched = v.patchAvailability.state === 'blocks' && /fix-shipped|shipped/i.test(v.patchAvailability.evidence + v.patchAvailability.ref);
  const dastCovered = v.detectability.state === 'blocks' && /dast|bola|probe/i.test(v.detectability.ref + v.detectability.evidence);

  let verdict;
  if (patched) verdict = 'fixed';
  else if (quorumMet >= QUORUM && v.reachability.state === 'blocks' && dastCovered) verdict = 'inexploitable';
  else if (quorumMet >= QUORUM) verdict = 'contained';
  // D-UNMEASURED: nobody read any axis, so there is no finding of "undefended" to report. Falling
  // through to `exploitable` here published a verdict as a side effect of the default value.
  else if (unmeasured) verdict = 'undetermined';
  else verdict = 'exploitable';

  // D-EXPIRE: contained/inexploitable require expires + recheckTrigger.
  if ((verdict === 'contained' || verdict === 'inexploitable')) {
    if (!rec.residualExpires) violations.push(`${verdict} requires residualExpires (D-EXPIRE)`);
    if (!rec.recheckTrigger) violations.push(`${verdict} requires recheckTrigger (D-EXPIRE)`);
  }
  // D-PROBE guard: inexploitable without dast is a violation (should have fallen to contained, but assert).
  if (verdict === 'inexploitable' && !dastCovered) violations.push('inexploitable without a DAST/BOLA probe (D-PROBE)');

  return { defenceVector: v, residualVerdict: verdict, quorumMet, quorumAxesBlocking: blocking, dedupNote, unmeasured, violations };
}

/** For client renders: never emit the literal word 'inexploitable' (D-EXPIRE). */
export function verdictForClient(verdict, expiresIso) {
  if (verdict === 'inexploitable' || verdict === 'contained') {
    const m = expiresIso ? ` (recheck ${String(expiresIso).slice(0, 7)})` : '';
    return `accepted+contained${m}`;
  }
  // D-UNMEASURED: say the absence out loud. 'undetermined' reads to a client as a hedge about the
  // finding; the honest claim is that nobody assessed the defences.
  if (verdict === 'undetermined') return 'defences not assessed';
  return verdict;
}
