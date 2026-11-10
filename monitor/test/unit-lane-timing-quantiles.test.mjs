// Computes min, p50, p95, max from an array of millisecond values (monitor/lane-timing.mjs quantiles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quantiles } from '../lane-timing.mjs';

test('returns all nulls when the input array is empty', () => {
  assert.deepEqual(quantiles([]), { min: null, p50: null, p95: null, max: null });
});

test('returns all nulls when every element is non-finite or not a number', () => {
  assert.deepEqual(quantiles([NaN, Infinity, -Infinity, 'x', null, undefined]), { min: null, p50: null, p95: null, max: null });
});

test('returns the single value for min, p50, p95, and max when there is one finite number', () => {
  assert.deepEqual(quantiles([42]), { min: 42, p50: 42, p95: 42, max: 42 });
});

test('returns the sorted endpoints and midpoint for three finite numbers', () => {
  assert.deepEqual(quantiles([30, 10, 20]), { min: 10, p50: 20, p95: 30, max: 30 });
});

test('returns the sorted endpoints and interpolated percentiles for ten finite numbers', () => {
  const ms = Array.from({ length: 10 }, (_, i) => (i + 1) * 10);
  assert.deepEqual(quantiles(ms), { min: 10, p50: 50, p95: 100, max: 100 });
});

test('returns the sorted endpoints and interpolated percentiles for twenty finite numbers', () => {
  const ms = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
  assert.deepEqual(quantiles(ms), { min: 5, p50: 50, p95: 95, max: 100 });
});

test('returns the sorted endpoints and interpolated percentiles for one hundred finite numbers', () => {
  const ms = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.deepEqual(quantiles(ms), { min: 1, p50: 50, p95: 95, max: 100 });
});

test('returns the sorted endpoints and interpolated percentiles for two hundred finite numbers', () => {
  const ms = Array.from({ length: 200 }, (_, i) => i + 1);
  assert.deepEqual(quantiles(ms), { min: 1, p50: 100, p95: 190, max: 200 });
});
