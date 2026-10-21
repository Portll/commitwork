// Applies pre-committed falsification thresholds to scored rates to determine if the D1 reducer works (monitor/detection-score.mjs evaluateGates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGates } from '../detection-score.mjs';

test('returns pass true when all rates meet or exceed thresholds', () => {
  const scored = {
    lob: { rate: 0.95 },
    heldout: { rate: 0.90 },
    positive: { rate: 1.0 },
    errorRate: 0.10
  };
  const result = evaluateGates(scored);
  assert.equal(result.pass, true);
  assert.equal(result.verdict, 'D1 REDUCER WORKS \u2014 ship');
  assert.equal(result.gates.length, 4);
  assert.equal(result.gates[0].name, 'lob-strict-collapse');
  assert.equal(result.gates[0].actual, 0.95);
  assert.equal(result.gates[0].pass, true);
  assert.equal(result.gates[1].name, 'heldout-non-fabrication');
  assert.equal(result.gates[1].actual, 0.90);
  assert.equal(result.gates[1].pass, true);
  assert.equal(result.gates[2].name, 'positive-control-survival');
  assert.equal(result.gates[2].actual, 1.0);
  assert.equal(result.gates[2].pass, true);
  assert.equal(result.gates[3].name, 'error-rate-fail-closed');
  assert.equal(result.gates[3].actual, 0.10);
  assert.equal(result.gates[3].pass, true);
});

test('returns pass false when lob rate is below threshold', () => {
  const scored = {
    lob: { rate: 0.94 },
    heldout: { rate: 0.90 },
    positive: { rate: 1.0 },
    errorRate: 0.10
  };
  const result = evaluateGates(scored);
  assert.equal(result.pass, false);
  assert.equal(result.verdict, 'D1 REDUCER NOT WORKING \u2014 do not ship the D lane');
  assert.equal(result.gates[0].pass, false);
  assert.equal(result.gates[1].pass, true);
  assert.equal(result.gates[2].pass, true);
  assert.equal(result.gates[3].pass, true);
});

test('returns pass false when heldout rate is below threshold', () => {
  const scored = {
    lob: { rate: 0.95 },
    heldout: { rate: 0.89 },
    positive: { rate: 1.0 },
    errorRate: 0.10
  };
  const result = evaluateGates(scored);
  assert.equal(result.pass, false);
  assert.equal(result.verdict, 'D1 REDUCER NOT WORKING \u2014 do not ship the D lane');
  assert.equal(result.gates[0].pass, true);
  assert.equal(result.gates[1].pass, false);
  assert.equal(result.gates[2].pass, true);
  assert.equal(result.gates[3].pass, true);
});

test('returns pass false when positive rate is below 1.0', () => {
  const scored = {
    lob: { rate: 0.95 },
    heldout: { rate: 0.90 },
    positive: { rate: 0.99 },
    errorRate: 0.10
  };
  const result = evaluateGates(scored);
  assert.equal(result.pass, false);
  assert.equal(result.verdict, 'D1 REDUCER NOT WORKING \u2014 do not ship the D lane');
  assert.equal(result.gates[0].pass, true);
  assert.equal(result.gates[1].pass, true);
  assert.equal(result.gates[2].pass, false);
  assert.equal(result.gates[3].pass, true);
});

test('returns pass false when error rate exceeds maximum', () => {
  const scored = {
    lob: { rate: 0.95 },
    heldout: { rate: 0.90 },
    positive: { rate: 1.0 },
    errorRate: 0.11
  };
  const result = evaluateGates(scored);
  assert.equal(result.pass, false);
  assert.equal(result.verdict, 'D1 REDUCER NOT WORKING \u2014 do not ship the D lane');
  assert.equal(result.gates[0].pass, true);
  assert.equal(result.gates[1].pass, true);
  assert.equal(result.gates[2].pass, true);
  assert.equal(result.gates[3].pass, false);
});

test('returns pass false when any rate is null', () => {
  const scored = {
    lob: { rate: null },
    heldout: { rate: 0.90 },
    positive: { rate: 1.0 },
    errorRate: 0.10
  };
  const result = evaluateGates(scored);
  assert.equal(result.pass, false);
  assert.equal(result.verdict, 'D1 REDUCER NOT WORKING \u2014 do not ship the D lane');
  assert.equal(result.gates[0].actual, null);
  assert.equal(result.gates[0].pass, false);
  assert.equal(result.gates[1].pass, true);
  assert.equal(result.gates[2].pass, true);
  assert.equal(result.gates[3].pass, true);
});

test('returns pass false when multiple rates fail', () => {
  const scored = {
    lob: { rate: 0.50 },
    heldout: { rate: 0.50 },
    positive: { rate: 0.50 },
    errorRate: 0.50
  };
  const result = evaluateGates(scored);
  assert.equal(result.pass, false);
  assert.equal(result.verdict, 'D1 REDUCER NOT WORKING \u2014 do not ship the D lane');
  assert.equal(result.gates[0].pass, false);
  assert.equal(result.gates[1].pass, false);
  assert.equal(result.gates[2].pass, false);
  assert.equal(result.gates[3].pass, false);
});

test('returns pass true when rates exceed thresholds', () => {
  const scored = {
    lob: { rate: 0.99 },
    heldout: { rate: 0.95 },
    positive: { rate: 1.0 },
    errorRate: 0.05
  };
  const result = evaluateGates(scored);
  assert.equal(result.pass, true);
  assert.equal(result.verdict, 'D1 REDUCER WORKS \u2014 ship');
  assert.equal(result.gates[0].pass, true);
  assert.equal(result.gates[1].pass, true);
  assert.equal(result.gates[2].pass, true);
  assert.equal(result.gates[3].pass, true);
});
