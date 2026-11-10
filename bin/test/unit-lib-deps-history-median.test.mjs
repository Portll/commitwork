// Computes the median of a list of finite numbers (bin/lib/deps-history.mjs median).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { median } from '../lib/deps-history.mjs';

test('returns null for an empty array', () => {
  assert.equal(median([]), null);
});

test('returns null when all elements are non-finite', () => {
  assert.equal(median([NaN, Infinity, -Infinity]), null);
});

test('returns the single element for a one-element array', () => {
  assert.equal(median([42]), 42);
});

test('returns the middle element for an odd-length array', () => {
  assert.equal(median([5, 1, 3, 2, 4]), 3);
});

test('returns the average of the two middle elements for an even-length array', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('filters out non-number types before computing', () => {
  assert.equal(median(['a', 10, null, 20, undefined, 30]), 20);
});

test('handles unsorted input by sorting first', () => {
  assert.equal(median([100, 1, 50, 2, 75, 3]), 26.5);
});

test('returns the average of two equal middle elements', () => {
  assert.equal(median([5, 5, 5, 5]), 5);
});
