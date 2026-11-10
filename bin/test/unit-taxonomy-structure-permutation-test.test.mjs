// Computes a permutation-test p-value for within-group vs between-group similarity (bin/taxonomy-structure.mjs permutationTest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permutationTest } from '../taxonomy-structure.mjs';

test('returns zero within and between for a single element', () => {
  const S = [[0]];
  const labels = ['a'];
  const r = permutationTest(S, labels, 10, 42);
  assert.deepEqual(r, { within: 0, between: 0, diff: 0, perms: 10, p: 1 });
});

test('returns zero within and between for two elements of the same label', () => {
  const S = [[0, 1], [1, 0]];
  const labels = ['a', 'a'];
  const r = permutationTest(S, labels, 10, 42);
  assert.deepEqual(r, { within: 1, between: 0, diff: 1, perms: 10, p: 1 });
});

test('returns zero within and between for two elements of different labels', () => {
  const S = [[0, 1], [1, 0]];
  const labels = ['a', 'b'];
  const r = permutationTest(S, labels, 10, 42);
  assert.deepEqual(r, { within: 0, between: 1, diff: -1, perms: 10, p: 1 });
});

test('computes within and between means for three elements with two labels', () => {
  const S = [[0, 1, 2], [1, 0, 3], [2, 3, 0]];
  const labels = ['a', 'a', 'b'];
  const r = permutationTest(S, labels, 10, 42);
  assert.deepEqual(r, { within: 1, between: 2.5, diff: -1.5, perms: 10, p: 1 });
});

test('computes within and between means for four elements with two labels', () => {
  const S = [[0, 1, 2, 3], [1, 0, 4, 5], [2, 4, 0, 6], [3, 5, 6, 0]];
  const labels = ['a', 'a', 'b', 'b'];
  const r = permutationTest(S, labels, 10, 42);
  assert.deepEqual(r, { within: 3.5, between: 3.5, diff: 0, perms: 10, p: 1 });
});

test('computes within and between means for five elements with three labels', () => {
  const S = [[0, 1, 2, 3, 4], [1, 0, 5, 6, 7], [2, 5, 0, 8, 9], [3, 6, 8, 0, 10], [4, 7, 9, 10, 0]];
  const labels = ['a', 'a', 'b', 'b', 'c'];
  const r = permutationTest(S, labels, 10, 42);
  assert.deepEqual(r, { within: 4.5, between: 5.75, diff: -1.25, perms: 10, p: 1 });
});

test('computes within and between means for six elements with two labels', () => {
  const S = [[0, 1, 2, 3, 4, 5], [1, 0, 6, 7, 8, 9], [2, 6, 0, 10, 11, 12], [3, 7, 10, 0, 13, 14], [4, 8, 11, 13, 0, 15], [5, 9, 12, 14, 15, 0]];
  const labels = ['a', 'a', 'a', 'b', 'b', 'b'];
  const r = permutationTest(S, labels, 10, 42);
  assert.deepEqual(r, { within: 8.5, between: 7.666666666666667, diff: 0.833333333333333, perms: 10, p: 0.18181818181818182 });
});

test('computes within and between means for seven elements with three labels', () => {
  const S = [[0, 1, 2, 3, 4, 5, 6], [1, 0, 7, 8, 9, 10, 11], [2, 7, 0, 12, 13, 14, 15], [3, 8, 12, 0, 16, 17, 18], [4, 9, 13, 16, 0, 19, 20], [5, 10, 14, 17, 19, 0, 21], [6, 11, 15, 18, 20, 21, 0]];
  const labels = ['a', 'a', 'b', 'b', 'c', 'c', 'c'];
  const r = permutationTest(S, labels, 10, 42);
  assert.deepEqual(r, { within: 14.6, between: 9.875, diff: 4.725, perms: 10, p: 0.09090909090909091 });
});

test('computes within and between means for eight elements with four labels', () => {
  const S = [[0, 1, 2, 3, 4, 5, 6, 7], [1, 0, 8, 9, 10, 11, 12, 13], [2, 8, 0, 14, 15, 16, 17, 18], [3, 9, 14, 0, 19, 20, 21, 22], [4, 10, 15, 19, 0, 23, 24, 25], [5, 11, 16, 20, 23, 0, 26, 27], [6, 12, 17, 21, 24, 26, 0, 28], [7, 13, 18, 22, 25, 27, 28, 0]];
  const labels = ['a', 'b', 'c', 'd', 'a', 'b', 'c', 'd'];
  const r = permutationTest(S, labels, 10, 42);
  assert.deepEqual(r, { within: 13.5, between: 14.666666666666666, diff: -1.166666666666666, perms: 10, p: 1 });
});
