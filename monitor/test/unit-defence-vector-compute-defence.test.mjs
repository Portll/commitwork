// Computes the residual defence verdict and quorum from a raw defence vector (monitor/defence-vector.mjs computeDefence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDefence } from '../defence-vector.mjs';

test('downgrades prose-only reachability blocks to partial', () => {
  const rec = { defenceVector: { reachability: { state: 'blocks', evidence: 'manual review' } } };
  assert.deepEqual(computeDefence(rec), { defenceVector: { reachability: { state: "partial", evidence: "manual review", ref: "", rationale: "D-PROBE: reachability block downgraded to partial \u2014 no computed/DAST evidence (prose-only)", who: undefined, at: undefined }, networkExposure: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, authnAuthz: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, inputMediation: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, privilegeBlast: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, dataAtRisk: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, detectability: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, patchAvailability: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined } }, residualVerdict: "exploitable", quorumMet: 0, quorumAxesBlocking: [], dedupNote: null, unmeasured: false, violations: [] });
});

test('keeps reachability blocks when backed by dast evidence', () => {
  const rec = { defenceVector: { reachability: { state: 'blocks', ref: 'dast-scan' } } };
  assert.deepEqual(computeDefence(rec), { defenceVector: { reachability: { state: "blocks", evidence: "", ref: "dast-scan", rationale: undefined, who: undefined, at: undefined }, networkExposure: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, authnAuthz: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, inputMediation: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, privilegeBlast: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, dataAtRisk: { state: "n/a", evidence: "", ref: "", rationale: "D-ORTHO: reachability blocks => vulnerable path not invoked => dataAtRisk vacuous (not double-counted)" }, detectability: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, patchAvailability: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined } }, residualVerdict: "exploitable", quorumMet: 1, quorumAxesBlocking: ["reachability"], dedupNote: null, unmeasured: false, violations: [] });
});

test('short-circuits dataAtRisk to n/a when reachability blocks', () => {
  const rec = { defenceVector: { reachability: { state: 'blocks', ref: 'call-graph' }, dataAtRisk: { state: 'blocks', evidence: 'pii' } } };
  assert.deepEqual(computeDefence(rec), { defenceVector: { reachability: { state: "blocks", evidence: "", ref: "call-graph", rationale: undefined, who: undefined, at: undefined }, networkExposure: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, authnAuthz: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, inputMediation: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, privilegeBlast: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, dataAtRisk: { state: "n/a", evidence: "pii", ref: "", rationale: "D-ORTHO: reachability blocks => vulnerable path not invoked => dataAtRisk vacuous (not double-counted)" }, detectability: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, patchAvailability: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined } }, residualVerdict: "exploitable", quorumMet: 1, quorumAxesBlocking: ["reachability"], dedupNote: null, unmeasured: false, violations: [] });
});

test('dedupes networkExposure and authnAuthz sharing internal-network control', () => {
  const rec = { defenceVector: {
    networkExposure: { state: 'blocks', ref: 'internal-network' },
    authnAuthz: { state: 'blocks', ref: 'internal-network' },
    reachability: { state: 'blocks', ref: 'call-graph' },
    inputMediation: { state: 'blocks' },
    privilegeBlast: { state: 'blocks' },
    dataAtRisk: { state: 'blocks' },
    detectability: { state: 'blocks', ref: 'dast' }
  }, residualExpires: '2025-01-01', recheckTrigger: 'scan' };
  assert.deepEqual(computeDefence(rec), { defenceVector: { reachability: { state: "blocks", evidence: "", ref: "call-graph", rationale: undefined, who: undefined, at: undefined }, networkExposure: { state: "blocks", evidence: "", ref: "internal-network", rationale: undefined, who: undefined, at: undefined }, authnAuthz: { state: "blocks", evidence: "", ref: "internal-network", rationale: undefined, who: undefined, at: undefined }, inputMediation: { state: "blocks", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, privilegeBlast: { state: "blocks", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, dataAtRisk: { state: "n/a", evidence: "", ref: "", rationale: "D-ORTHO: reachability blocks => vulnerable path not invoked => dataAtRisk vacuous (not double-counted)" }, detectability: { state: "blocks", evidence: "", ref: "dast", rationale: undefined, who: undefined, at: undefined }, patchAvailability: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined } }, residualVerdict: "inexploitable", quorumMet: 5, quorumAxesBlocking: ["reachability", "networkExposure", "inputMediation", "privilegeBlast", "detectability"], dedupNote: "networkExposure & authnAuthz share the same control \u2014 counted once toward quorum (D-ORTHO)", unmeasured: false, violations: [] });
});

test('flags n/a axis without rationale as violation', () => {
  const rec = { defenceVector: { reachability: { state: 'n/a' } } };
  assert.deepEqual(computeDefence(rec), { defenceVector: { reachability: { state: "n/a", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, networkExposure: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, authnAuthz: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, inputMediation: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, privilegeBlast: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, dataAtRisk: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, detectability: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, patchAvailability: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined } }, residualVerdict: "exploitable", quorumMet: 0, quorumAxesBlocking: [], dedupNote: null, unmeasured: false, violations: ["axis reachability is n/a without rationale"] });
});

test('returns fixed verdict when patch is shipped', () => {
  const rec = { defenceVector: { patchAvailability: { state: 'blocks', evidence: 'fix-shipped' } } };
  assert.deepEqual(computeDefence(rec), { defenceVector: { reachability: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, networkExposure: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, authnAuthz: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, inputMediation: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, privilegeBlast: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, dataAtRisk: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, detectability: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, patchAvailability: { state: "blocks", evidence: "fix-shipped", ref: "", rationale: undefined, who: undefined, at: undefined } }, residualVerdict: "fixed", quorumMet: 0, quorumAxesBlocking: [], dedupNote: null, unmeasured: false, violations: [] });
});

test('returns undetermined when all axes are unmeasured', () => {
  const rec = { defenceVector: {} };
  assert.deepEqual(computeDefence(rec), { defenceVector: { reachability: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, networkExposure: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, authnAuthz: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, inputMediation: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, privilegeBlast: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, dataAtRisk: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, detectability: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, patchAvailability: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined } }, residualVerdict: "undetermined", quorumMet: 0, quorumAxesBlocking: [], dedupNote: null, unmeasured: true, violations: [] });
});

test('returns contained when quorum met without dast', () => {
  const rec = { defenceVector: {
    reachability: { state: 'blocks', ref: 'call-graph' },
    networkExposure: { state: 'blocks' },
    authnAuthz: { state: 'blocks' },
    inputMediation: { state: 'blocks' },
    privilegeBlast: { state: 'blocks' },
    dataAtRisk: { state: 'blocks' },
    detectability: { state: 'blocks' }
  }, residualExpires: '2025-01-01', recheckTrigger: 'scan' };
  assert.deepEqual(computeDefence(rec), { defenceVector: { reachability: { state: "blocks", evidence: "", ref: "call-graph", rationale: undefined, who: undefined, at: undefined }, networkExposure: { state: "blocks", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, authnAuthz: { state: "blocks", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, inputMediation: { state: "blocks", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, privilegeBlast: { state: "blocks", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, dataAtRisk: { state: "n/a", evidence: "", ref: "", rationale: "D-ORTHO: reachability blocks => vulnerable path not invoked => dataAtRisk vacuous (not double-counted)" }, detectability: { state: "blocks", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, patchAvailability: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined } }, residualVerdict: "contained", quorumMet: 6, quorumAxesBlocking: ["reachability", "networkExposure", "authnAuthz", "inputMediation", "privilegeBlast", "detectability"], dedupNote: null, unmeasured: false, violations: [] });
});

test('returns inexploitable when quorum met with reachability blocks and dast', () => {
  const rec = { defenceVector: {
    reachability: { state: 'blocks', ref: 'call-graph' },
    networkExposure: { state: 'blocks' },
    authnAuthz: { state: 'blocks' },
    inputMediation: { state: 'blocks' },
    privilegeBlast: { state: 'blocks' },
    dataAtRisk: { state: 'blocks' },
    detectability: { state: 'blocks', ref: 'dast' }
  }, residualExpires: '2025-01-01', recheckTrigger: 'scan' };
  assert.deepEqual(computeDefence(rec), { defenceVector: { reachability: { state: "blocks", evidence: "", ref: "call-graph", rationale: undefined, who: undefined, at: undefined }, networkExposure: { state: "blocks", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, authnAuthz: { state: "blocks", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, inputMediation: { state: "blocks", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, privilegeBlast: { state: "blocks", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, dataAtRisk: { state: "n/a", evidence: "", ref: "", rationale: "D-ORTHO: reachability blocks => vulnerable path not invoked => dataAtRisk vacuous (not double-counted)" }, detectability: { state: "blocks", evidence: "", ref: "dast", rationale: undefined, who: undefined, at: undefined }, patchAvailability: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined } }, residualVerdict: "inexploitable", quorumMet: 6, quorumAxesBlocking: ["reachability", "networkExposure", "authnAuthz", "inputMediation", "privilegeBlast", "detectability"], dedupNote: null, unmeasured: false, violations: [] });
});

test('returns exploitable when quorum not met and measured', () => {
  const rec = { defenceVector: { reachability: { state: 'blocks', ref: 'call-graph' } } };
  assert.deepEqual(computeDefence(rec), { defenceVector: { reachability: { state: "blocks", evidence: "", ref: "call-graph", rationale: undefined, who: undefined, at: undefined }, networkExposure: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, authnAuthz: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, inputMediation: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, privilegeBlast: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, dataAtRisk: { state: "n/a", evidence: "", ref: "", rationale: "D-ORTHO: reachability blocks => vulnerable path not invoked => dataAtRisk vacuous (not double-counted)" }, detectability: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined }, patchAvailability: { state: "open", evidence: "", ref: "", rationale: undefined, who: undefined, at: undefined } }, residualVerdict: "exploitable", quorumMet: 1, quorumAxesBlocking: ["reachability"], dedupNote: null, unmeasured: false, violations: [] });
});
