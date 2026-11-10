// Returns the gap at a given percentile of a sorted array (monitor/coincidence.mjs percentileGap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentileGap } from '../coincidence.mjs';

test('returns null when the input array is empty', () => {
  assert.equal(percentileGap([], 50), null);
});

test('returns the first element for a single-element array at any percentile', () => {
  assert.equal(percentileGap([42], 50), 42);
});

test('returns the last element when the percentile maps to the end of the array', () => {
  assert.equal(percentileGap([1, 2, 3, 4, 5], 100), 5);
});

test('returns the element at the floor of the percentile index', () => {
  assert.equal(percentileGap([10, 20, 30, 40, 50], 50), 30);
});

test('returns the first element when the percentile is zero', () => {
  assert.equal(percentileGap([10, 20, 30, 40, 50], 0), 10);
});

test('returns the element at the computed index for a non-trivial percentile', () => {
  assert.equal(percentileGap([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 30), 4);
});

test('returns the element at the computed index for a high percentile', () => {
  assert.equal(percentileGap([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 10);
});

test('returns the element at the computed index for a low percentile', () => {
  assert.equal(percentileGap([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 10), 2);
});
