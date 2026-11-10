// Intersection of attribute sets across an extent (bin/lib/fca.mjs intentOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intentOf } from '../lib/fca.mjs';

test('returns null for an empty extent', () => {
  const objects = new Map([['a', new Set(['x'])]]);
  assert.deepEqual(intentOf([], objects), null);
});

test('returns the attribute set for a single object', () => {
  const objects = new Map([['a', new Set(['x', 'y'])]]);
  assert.deepEqual(intentOf(['a'], objects), new Set(["x", "y"]));
});

test('throws for an unknown object id', () => {
  const objects = new Map([['a', new Set(['x'])]]);
  assert.throws(() => intentOf(['a', 'missing'], objects), { name: 'Error', message: 'fca: unknown object missing' });
});

test('intersects attributes across two objects', () => {
  const objects = new Map([
    ['a', new Set(['x', 'y', 'z'])],
    ['b', new Set(['y', 'z', 'w'])]
  ]);
  assert.deepEqual(intentOf(['a', 'b'], objects), new Set(["y", "z"]));
});

test('intersects attributes across three objects', () => {
  const objects = new Map([
    ['a', new Set(['x', 'y', 'z'])],
    ['b', new Set(['y', 'z', 'w'])],
    ['c', new Set(['y', 'v'])]
  ]);
  assert.deepEqual(intentOf(['a', 'b', 'c'], objects), new Set(["y"]));
});

test('returns empty set when no attributes are shared', () => {
  const objects = new Map([
    ['a', new Set(['x'])],
    ['b', new Set(['y'])]
  ]);
  assert.deepEqual(intentOf(['a', 'b'], objects), new Set([]));
});

test('returns empty set when second object has no shared attributes', () => {
  const objects = new Map([
    ['a', new Set(['x', 'y'])],
    ['b', new Set(['z'])]
  ]);
  assert.deepEqual(intentOf(['a', 'b'], objects), new Set([]));
});

test('returns single attribute when all objects share exactly one', () => {
  const objects = new Map([
    ['a', new Set(['x', 'y'])],
    ['b', new Set(['x', 'z'])],
    ['c', new Set(['x', 'w'])]
  ]);
  assert.deepEqual(intentOf(['a', 'b', 'c'], objects), new Set(["x"]));
});
