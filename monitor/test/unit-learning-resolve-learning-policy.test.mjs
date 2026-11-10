// Merges supplied learning parameters with defaults and validates ranges (monitor/learning.mjs resolveLearningPolicy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLearningPolicy } from '../learning.mjs';

test('returns all default values when called with no arguments', () => {
  const result = resolveLearningPolicy();
  assert.deepEqual(result, {
    rampObservations: 8,
    weightFloor: 0.05,
    strongWeightFloor: 0.20,
    learningDecayRate: Math.log(2) / 90,
    reinforceBonus: 0.15,
    contradictionPenalty: 0.25,
    jaccardThreshold: 0.45,
    minSupport: 3,
    tierStrongMinObservations: 4,
    tierStrongMinConfidence: 0.75,
    tierMediumMinConfidence: 0.5,
    tierWeakMaxObservations: 2,
  });
});

test('returns all default values when called with an empty object', () => {
  const result = resolveLearningPolicy({});
  assert.deepEqual(result, {
    rampObservations: 8,
    weightFloor: 0.05,
    strongWeightFloor: 0.20,
    learningDecayRate: Math.log(2) / 90,
    reinforceBonus: 0.15,
    contradictionPenalty: 0.25,
    jaccardThreshold: 0.45,
    minSupport: 3,
    tierStrongMinObservations: 4,
    tierStrongMinConfidence: 0.75,
    tierMediumMinConfidence: 0.5,
    tierWeakMaxObservations: 2,
  });
});

test('merges supplied values over defaults for provided keys', () => {
  const result = resolveLearningPolicy({ rampObservations: 10, weightFloor: 0.1 });
  assert.equal(result.rampObservations, 10);
  assert.equal(result.weightFloor, 0.1);
  assert.equal(result.strongWeightFloor, 0.20);
  assert.equal(result.learningDecayRate, Math.log(2) / 90);
  assert.equal(result.reinforceBonus, 0.15);
  assert.equal(result.contradictionPenalty, 0.25);
  assert.equal(result.jaccardThreshold, 0.45);
  assert.equal(result.minSupport, 3);
  assert.equal(result.tierStrongMinObservations, 4);
  assert.equal(result.tierStrongMinConfidence, 0.75);
  assert.equal(result.tierMediumMinConfidence, 0.5);
  assert.equal(result.tierWeakMaxObservations, 2);
});

test('reads parameters from learningParameters property when present', () => {
  const result = resolveLearningPolicy({ learningParameters: { rampObservations: 5, minSupport: 10 } });
  assert.equal(result.rampObservations, 5);
  assert.equal(result.minSupport, 10);
  assert.equal(result.weightFloor, 0.05);
});

test('reads parameters from learningPolicy property when learningParameters is absent', () => {
  const result = resolveLearningPolicy({ learningPolicy: { rampObservations: 7, minSupport: 4 } });
  assert.equal(result.rampObservations, 7);
  assert.equal(result.minSupport, 4);
  assert.equal(result.weightFloor, 0.05);
});

test('prefers learningParameters over learningPolicy when both are present', () => {
  const result = resolveLearningPolicy({
    learningParameters: { rampObservations: 6 },
    learningPolicy: { rampObservations: 9 },
  });
  assert.equal(result.rampObservations, 6);
});

test('throws when rampObservations is below the minimum of 1', () => {
  assert.throws(() => resolveLearningPolicy({ rampObservations: 0 }), /rampObservations must be in \[1/);
});

test('throws when weightFloor exceeds the maximum of 1', () => {
  assert.throws(() => resolveLearningPolicy({ weightFloor: 1.5 }), /weightFloor must be in \[0,1\]/);
});

test('throws when minSupport is below the minimum of 1', () => {
  assert.throws(() => resolveLearningPolicy({ minSupport: 0 }), /minSupport must be in \[1/);
});

test('accepts boundary values at the edges of valid ranges', () => {
  const result = resolveLearningPolicy({
    rampObservations: 1,
    weightFloor: 0,
    strongWeightFloor: 1,
    learningDecayRate: 0,
    reinforceBonus: 1,
    contradictionPenalty: 0,
    jaccardThreshold: 1,
    minSupport: 1,
    tierStrongMinObservations: 0,
    tierStrongMinConfidence: 1,
    tierMediumMinConfidence: 0,
    tierWeakMaxObservations: 0,
  });
  assert.equal(result.rampObservations, 1);
  assert.equal(result.weightFloor, 0);
  assert.equal(result.strongWeightFloor, 1);
  assert.equal(result.learningDecayRate, 0);
  assert.equal(result.reinforceBonus, 1);
  assert.equal(result.contradictionPenalty, 0);
  assert.equal(result.jaccardThreshold, 1);
  assert.equal(result.minSupport, 1);
  assert.equal(result.tierStrongMinObservations, 0);
  assert.equal(result.tierStrongMinConfidence, 1);
  assert.equal(result.tierMediumMinConfidence, 0);
  assert.equal(result.tierWeakMaxObservations, 0);
});

test('throws when strongWeightFloor exceeds the maximum of 1', () => {
  assert.throws(() => resolveLearningPolicy({ strongWeightFloor: 1.5 }), /strongWeightFloor must be in \[0,1\]/);
});

test('throws when contradictionPenalty exceeds the maximum of 1', () => {
  assert.throws(() => resolveLearningPolicy({ contradictionPenalty: 1.5 }), /contradictionPenalty must be in \[0,1\]/);
});

test('throws when jaccardThreshold exceeds the maximum of 1', () => {
  assert.throws(() => resolveLearningPolicy({ jaccardThreshold: 1.5 }), /jaccardThreshold must be in \[0,1\]/);
});

test('throws when tierStrongMinConfidence exceeds the maximum of 1', () => {
  assert.throws(() => resolveLearningPolicy({ tierStrongMinConfidence: 1.5 }), /tierStrongMinConfidence must be in \[0,1\]/);
});

test('throws when tierMediumMinConfidence exceeds the maximum of 1', () => {
  assert.throws(() => resolveLearningPolicy({ tierMediumMinConfidence: 1.5 }), /tierMediumMinConfidence must be in \[0,1\]/);
});
