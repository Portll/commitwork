// Symmetric matrix of pairwise sparse dot-product similarities with ones on the diagonal (bin/taxonomy-structure.mjs similarityMatrix).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { similarityMatrix } from '../taxonomy-structure.mjs';

test('an empty list of vectors gives an empty matrix', () => {
  assert.deepEqual(similarityMatrix([]), []);
});

test('a single vector gives a one by one matrix holding exactly one', () => {
  assert.deepEqual(similarityMatrix([new Map([['a', 3]])]), [Float64Array.of(1)]);
});

test('two overlapping vectors get their dot product in both off diagonal cells', () => {
  const v0 = new Map([['a', 2], ['b', 3]]);
  const v1 = new Map([['a', 4], ['c', 5]]);
  assert.deepEqual(similarityMatrix([v0, v1]), [Float64Array.of(1, 8), Float64Array.of(8, 1)]);
});

test('three vectors fill every pair including adjacent and distant ones', () => {
  const v0 = new Map([['x', 1]]);
  const v1 = new Map([['x', 2], ['y', 1]]);
  const v2 = new Map([['y', 3]]);
  assert.deepEqual(similarityMatrix([v0, v1, v2]), [
    Float64Array.of(1, 2, 0),
    Float64Array.of(2, 1, 3),
    Float64Array.of(0, 3, 1),
  ]);
});

test('two empty vectors have zero similarity but keep ones on the diagonal', () => {
  assert.deepEqual(similarityMatrix([new Map(), new Map()]), [Float64Array.of(1, 0), Float64Array.of(0, 1)]);
});

test('negative weights produce a negative similarity', () => {
  assert.deepEqual(similarityMatrix([new Map([['a', -2]]), new Map([['a', 3]])]), [
    Float64Array.of(1, -6),
    Float64Array.of(-6, 1),
  ]);
});

test('fractional weights multiply into a fractional similarity', () => {
  assert.deepEqual(similarityMatrix([new Map([['a', 0.5]]), new Map([['a', 0.5]])]), [
    Float64Array.of(1, 0.25),
    Float64Array.of(0.25, 1),
  ]);
});
