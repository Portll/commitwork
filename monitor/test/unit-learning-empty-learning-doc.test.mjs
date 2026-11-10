// Builds the initial learning document snapshot (monitor/learning.mjs emptyLearningDoc).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyLearningDoc } from '../learning.mjs';

const FIXED_NOW = 1700000000000;
const FIXED_GENERATED_AT = '2023-11-14T22:13:20.000Z';
const DEFAULT_POLICY_SNAPSHOT = {
  rampObservations: 8,
  weightFloor: 0.05,
  strongWeightFloor: 0.2,
  learningDecayRate: Math.log(2) / 90,
  reinforceBonus: 0.15,
  contradictionPenalty: 0.25,
  jaccardThreshold: 0.45,
  minSupport: 3,
  tierStrongMinObservations: 4,
  tierStrongMinConfidence: 0.75,
  tierMediumMinConfidence: 0.5,
  tierWeakMaxObservations: 2,
};
const BASE_EXPECTED = {
  note: 'commitwork learning view \u2014 regenerated from monitor/issues.json events[] (+ CW_NOW at rebuild). Never edit by hand. Verify: node bin/learning-rebuild.mjs --verify',
  version: 1,
  generatedAt: FIXED_GENERATED_AT,
  sourceEventCount: 0,
  sourceChainHead: null,
  policySnapshot: DEFAULT_POLICY_SNAPSHOT,
  patterns: {},
};

test('returns the default document when no arguments are provided', () => {
  const result = emptyLearningDoc({ now: FIXED_NOW });
  assert.deepEqual(result, BASE_EXPECTED);
});

test('uses the supplied now value for generatedAt', () => {
  const input = { now: FIXED_NOW };
  const result = emptyLearningDoc(input);
  assert.deepEqual(result, BASE_EXPECTED);
});

test('uses the supplied sourceEventCount and sourceChainHead', () => {
  const input = { now: FIXED_NOW, sourceEventCount: 42, sourceChainHead: 'abc123' };
  const expected = { ...BASE_EXPECTED, sourceEventCount: 42, sourceChainHead: 'abc123' };
  const result = emptyLearningDoc(input);
  assert.deepEqual(result, expected);
});

test('resolves a custom policy into the policySnapshot', () => {
  const input = { now: FIXED_NOW, policy: { rampObservations: 10, weightFloor: 0.1 } };
  const expectedPolicy = { ...DEFAULT_POLICY_SNAPSHOT, rampObservations: 10, weightFloor: 0.1 };
  const expected = { ...BASE_EXPECTED, policySnapshot: expectedPolicy };
  const result = emptyLearningDoc(input);
  assert.deepEqual(result, expected);
});

test('accepts a policy wrapped in learningParameters', () => {
  const input = { now: FIXED_NOW, policy: { learningParameters: { minSupport: 5 } } };
  const expectedPolicy = { ...DEFAULT_POLICY_SNAPSHOT, minSupport: 5 };
  const expected = { ...BASE_EXPECTED, policySnapshot: expectedPolicy };
  const result = emptyLearningDoc(input);
  assert.deepEqual(result, expected);
});

test('accepts a policy wrapped in learningPolicy', () => {
  const input = { now: FIXED_NOW, policy: { learningPolicy: { jaccardThreshold: 0.9 } } };
  const expectedPolicy = { ...DEFAULT_POLICY_SNAPSHOT, jaccardThreshold: 0.9 };
  const expected = { ...BASE_EXPECTED, policySnapshot: expectedPolicy };
  const result = emptyLearningDoc(input);
  assert.deepEqual(result, expected);
});

test('throws when a policy value is out of range', () => {
  const input = { now: FIXED_NOW, policy: { weightFloor: 1.5 } };
  assert.throws(() => emptyLearningDoc(input), { name: 'Error', message: 'learning policy weightFloor must be in [0,1]' });
});

test('throws when a policy value is not finite', () => {
  const input = { now: FIXED_NOW, policy: { rampObservations: NaN } };
  assert.throws(() => emptyLearningDoc(input), { name: 'Error', message: 'learning policy rampObservations must be in [1,Infinity]' });
});

test('defaults sourceEventCount to zero', () => {
  const result = emptyLearningDoc({ now: FIXED_NOW });
  assert.equal(result.sourceEventCount, 0);
});

test('defaults version to one', () => {
  const result = emptyLearningDoc({ now: FIXED_NOW });
  assert.equal(result.version, 1);
});
