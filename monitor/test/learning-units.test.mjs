// monitor/test/learning-units.test.mjs — case tests for resolveLearningPolicy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLearningPolicy } from '../learning.mjs';

test('returns defaults when called with no argument', () => {
  const p = resolveLearningPolicy();
  assert.equal(p.rampObservations, 8);
  assert.equal(p.weightFloor, 0.05);
  assert.equal(p.strongWeightFloor, 0.20);
  assert.equal(p.learningDecayRate, Math.log(2) / 90);
  assert.equal(p.reinforceBonus, 0.15);
  assert.equal(p.contradictionPenalty, 0.25);
  assert.equal(p.jaccardThreshold, 0.45);
  assert.equal(p.minSupport, 3);
  assert.equal(p.tierStrongMinObservations, 4);
  assert.equal(p.tierStrongMinConfidence, 0.75);
  assert.equal(p.tierMediumMinConfidence, 0.5);
  assert.equal(p.tierWeakMaxObservations, 2);
});

test('merges supplied values over defaults', () => {
  const p = resolveLearningPolicy({ rampObservations: 10, weightFloor: 0.1 });
  assert.equal(p.rampObservations, 10);
  assert.equal(p.weightFloor, 0.1);
  assert.equal(p.strongWeightFloor, 0.20);
  assert.equal(p.minSupport, 3);
});

test('reads from learningParameters key', () => {
  const p = resolveLearningPolicy({ learningParameters: { minSupport: 5 } });
  assert.equal(p.minSupport, 5);
  assert.equal(p.rampObservations, 8);
});

test('reads from learningPolicy key', () => {
  const p = resolveLearningPolicy({ learningPolicy: { jaccardThreshold: 0.9 } });
  assert.equal(p.jaccardThreshold, 0.9);
  assert.equal(p.rampObservations, 8);
});

test('throws when rampObservations is below 1', () => {
  assert.throws(() => resolveLearningPolicy({ rampObservations: 0 }), /rampObservations must be in \[1,/);
});

test('throws when weightFloor exceeds 1', () => {
  assert.throws(() => resolveLearningPolicy({ weightFloor: 1.5 }), /weightFloor must be in \[0,1\]/);
});

test('throws when minSupport is below 1', () => {
  assert.throws(() => resolveLearningPolicy({ minSupport: 0 }), /minSupport must be in \[1,/);
});

test('throws when learningDecayRate is negative', () => {
  assert.throws(() => resolveLearningPolicy({ learningDecayRate: -0.1 }), /learningDecayRate must be in \[0,/);
});
