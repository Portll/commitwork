// computes the median of a numeric array (lib/taxonomy-distance.mjs median).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { median } from '../taxonomy-distance.mjs';

test('returns null for an empty input array', () => {
  assert.equal(median([]), null);
});

test('returns the single element for a one-element array', () => {
  assert.equal(median([5]), 5);
});

test('returns the middle element for an odd-length array', () => {
  assert.equal(median([3, 1, 2]), 2);
});

test('returns the average of the two middle elements for an even-length array', () => {
  assert.equal(median([4, 2, 1, 3]), 2.5);
});

test('returns the average of the two middle elements for a two-element array', () => {
  assert.equal(median([10, 20]), 15);
});

test('returns the middle element for a five-element array', () => {
  assert.equal(median([5, 1, 3, 2, 4]), 3);
});

test('returns the average of the two middle elements for a six-element array', () => {
  assert.equal(median([6, 1, 2, 3, 4, 5]), 3.5);
});

test('returns the average of the two middle elements for a four-element array with distinct values', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
});
