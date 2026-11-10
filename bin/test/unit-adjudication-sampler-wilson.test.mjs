// Wilson score interval for binomial proportion (bin/adjudication-sampler.mjs wilson).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wilson } from '../adjudication-sampler.mjs';

test('returns null when k is not an integer', () => {
  assert.equal(wilson(1.5, 10), null);
});

test('returns null when n is not an integer', () => {
  assert.equal(wilson(1, 10.5), null);
});

test('returns null when n is zero', () => {
  assert.equal(wilson(0, 0), null);
});

test('returns null when n is negative', () => {
  assert.equal(wilson(0, -1), null);
});

test('returns null when k is negative', () => {
  assert.equal(wilson(-1, 10), null);
});

test('returns null when k exceeds n', () => {
  assert.equal(wilson(11, 10), null);
});

test('returns [0, 1] when k is 0 and n is positive', () => {
  assert.deepEqual(wilson(0, 10), [0, 0.2775401687666166]);
});

test('returns [0, 1] when k equals n', () => {
  assert.deepEqual(wilson(10, 10), [0.7224598312333834, 1]);
});

test('computes interval for k=1 n=10 with default z', () => {
  const z = 1.96;
  const p = 0.1;
  const d = 1 + (z * z) / 10;
  const centre = (p + (z * z) / 20) / d;
  const margin = (z * Math.sqrt((p * 0.9) / 10 + (z * z) / 400)) / d;
  const expected = [Math.max(0, centre - margin), Math.min(1, centre + margin)];
  assert.deepEqual(wilson(1, 10), expected);
});

test('computes interval for k=5 n=10 with default z', () => {
  const z = 1.96;
  const p = 0.5;
  const d = 1 + (z * z) / 10;
  const centre = (p + (z * z) / 20) / d;
  const margin = (z * Math.sqrt((p * 0.5) / 10 + (z * z) / 400)) / d;
  const expected = [Math.max(0, centre - margin), Math.min(1, centre + margin)];
  assert.deepEqual(wilson(5, 10), expected);
});
