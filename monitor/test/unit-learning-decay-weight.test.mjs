// Computes the decayed weight of a learned rule after a gap in days, clamped to a floor (monitor/learning.mjs decayWeight).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decayWeight } from '../learning.mjs';

test('returns the weight unchanged when the gap is zero days', () => {
  const result = decayWeight(0.8, 0, 0.05);
  assert.equal(result, 0.8);
});

test('decays the weight exponentially for a positive gap', () => {
  const result = decayWeight(1.0, 90, 0.05);
  assert.ok(Math.abs(result - 0.5) < 1e-10);
});

test('clamps the result to the floor when decay drops below it', () => {
  const result = decayWeight(0.1, 1000, 0.2);
  assert.equal(result, 0.2);
});

test('clamps the result to 1 when the weight is above 1', () => {
  const result = decayWeight(1.5, 0, 0.05);
  assert.equal(result, 1);
});

test('returns the floor when the weight is zero and the floor is positive', () => {
  const result = decayWeight(0, 10, 0.1);
  assert.equal(result, 0.1);
});

test('returns zero when both weight and floor are zero', () => {
  const result = decayWeight(0, 10, 0);
  assert.equal(result, 0);
});

test('throws an error when gapDays is negative', () => {
  assert.throws(() => decayWeight(0.5, -1, 0.05), /gapDays/);
});

test('throws an error when floor is negative', () => {
  assert.throws(() => decayWeight(0.5, 10, -0.1), /floor/);
});

test('throws an error when floor is greater than 1', () => {
  assert.throws(() => decayWeight(0.5, 10, 1.5), /floor/);
});

test('uses a custom decay rate from the policy', () => {
  const result = decayWeight(1.0, 10, 0.05, { learningDecayRate: 0.1 });
  assert.ok(Math.abs(result - Math.exp(-1.0)) < 1e-10);
});
