// Computes the Hasse diagram edges of a concept lattice (bin/lib/fca.mjs hasse).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasse } from '../lib/fca.mjs';

test('returns an empty array for an empty concept list', () => {
  assert.deepEqual(hasse([]), []);
});

test('returns no edges when intents are equal in size', () => {
  const list = [
    { intent: ['a', 'b'] },
    { intent: ['a', 'c'] }
  ];
  assert.deepEqual(hasse(list), []);
});

test('returns no edges when intents are identical', () => {
  const list = [
    { intent: ['a', 'b'] },
    { intent: ['a', 'b'] }
  ];
  assert.deepEqual(hasse(list), []);
});

test('returns an edge when one intent strictly contains another', () => {
  const list = [
    { intent: ['a', 'b', 'c'] },
    { intent: ['a', 'b'] }
  ];
  assert.deepEqual(hasse(list), [[0, 1]]);
});

test('omits an edge when a third concept covers the relation', () => {
  const list = [
    { intent: ['a', 'b', 'c'] },
    { intent: ['a', 'b'] },
    { intent: ['a', 'b', 'c', 'd'] }
  ];
  assert.deepEqual(hasse(list), [[0, 1], [2, 0]]);
});

test('returns edges for multiple strict containment relations', () => {
  const list = [
    { intent: ['a', 'b', 'c'] },
    { intent: ['a', 'b'] },
    { intent: ['a'] }
  ];
  assert.deepEqual(hasse(list), [[0, 1], [1, 2]]);
});

test('returns no edges when intents are disjoint', () => {
  const list = [
    { intent: ['a', 'b'] },
    { intent: ['c', 'd'] }
  ];
  assert.deepEqual(hasse(list), []);
});

test('returns no edges when the larger intent is missing an element of the smaller', () => {
  const list = [
    { intent: ['a', 'b', 'c'] },
    { intent: ['a', 'd'] }
  ];
  assert.deepEqual(hasse(list), []);
});
