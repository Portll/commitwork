// Agglomerative clustering order of items by pairwise similarity (bin/taxonomy-structure.mjs clusterOrder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterOrder } from '../taxonomy-structure.mjs';

test('returns the single index for a one-item matrix', () => {
  const S = [[0]];
  assert.deepEqual(clusterOrder(S), [0]);
});

test('returns the merged order for a two-item matrix with positive similarity', () => {
  const S = [[0, 1], [1, 0]];
  assert.deepEqual(clusterOrder(S), [0, 1]);
});

test('returns the merged order for a two-item matrix with zero similarity', () => {
  const S = [[0, 0], [0, 0]];
  assert.deepEqual(clusterOrder(S), [0, 1]);
});

test('returns the merged order for a three-item matrix with distinct similarities', () => {
  const S = [[0, 1, 0], [1, 0, 0], [0, 0, 0]];
  assert.deepEqual(clusterOrder(S), [2, 0, 1]);
});

test('returns the merged order for a three-item matrix with equal similarities', () => {
  const S = [[0, 1, 1], [1, 0, 1], [1, 1, 0]];
  assert.deepEqual(clusterOrder(S), [2, 0, 1]);
});

test('returns the merged order for a four-item matrix with block structure', () => {
  const S = [[0, 1, 0, 0], [1, 0, 0, 0], [0, 0, 0, 1], [0, 0, 1, 0]];
  assert.deepEqual(clusterOrder(S), [0, 1, 2, 3]);
});

test('returns the merged order for a four-item matrix with uniform similarity', () => {
  const S = [[0, 1, 1, 1], [1, 0, 1, 1], [1, 1, 0, 1], [1, 1, 1, 0]];
  assert.deepEqual(clusterOrder(S), [0, 1, 2, 3]);
});

test('returns the merged order for a five-item matrix with chain structure', () => {
  const S = [[0, 1, 0, 0, 0], [1, 0, 1, 0, 0], [0, 1, 0, 1, 0], [0, 0, 1, 0, 1], [0, 0, 0, 1, 0]];
  assert.deepEqual(clusterOrder(S), [0, 1, 4, 2, 3]);
});
