// Jaccard index of two sets (lib/text-similarity.mjs jaccard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jaccard } from '../text-similarity.mjs';

test('returns 1 when both sets are empty', () => {
  const a = new Set();
  const b = new Set();
  assert.equal(jaccard(a, b), 1);
});

test('returns 0 when one set is empty and the other is not', () => {
  const a = new Set();
  const b = new Set(['x']);
  assert.equal(jaccard(a, b), 0);
});

test('returns 1 when both sets are identical and non-empty', () => {
  const a = new Set(['x', 'y']);
  const b = new Set(['x', 'y']);
  assert.equal(jaccard(a, b), 1);
});

test('returns 0 when sets are disjoint and non-empty', () => {
  const a = new Set(['x']);
  const b = new Set(['y']);
  assert.equal(jaccard(a, b), 0);
});

test('returns 1/3 when one element is shared out of three total', () => {
  const a = new Set(['x', 'y']);
  const b = new Set(['x', 'z']);
  assert.equal(jaccard(a, b), 1 / 3);
});

test('returns 1/4 when one element is shared out of four total', () => {
  const a = new Set(['x', 'y', 'z']);
  const b = new Set(['x', 'w']);
  assert.equal(jaccard(a, b), 0.25);
});

test('returns 1/7 when one element is shared out of seven total', () => {
  const a = new Set(['a', 'b', 'c', 'd']);
  const b = new Set(['a', 'e', 'f', 'g']);
  assert.equal(jaccard(a, b), 1 / 7);
});

test('returns 1/3 when two elements are shared out of six total', () => {
  const a = new Set(['x', 'y', 'z', 'w']);
  const b = new Set(['x', 'y', 'p', 'q']);
  assert.equal(jaccard(a, b), 1 / 3);
});
