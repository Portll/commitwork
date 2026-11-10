// Returns sorted attributes that appear in exactly one object (bin/taxonomy-lattice.mjs singletonValues).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singletonValues } from '../taxonomy-lattice.mjs';

test('returns empty array for empty objects', () => {
  const r = singletonValues({});
  assert.deepEqual(r, []);
});

test('returns singleton attribute for single object', () => {
  const r = singletonValues({ o1: ['a'] });
  assert.deepEqual(r, ["a"]);
});

test('returns empty array when attribute appears in two objects', () => {
  const r = singletonValues({ o1: ['a'], o2: ['a'] });
  assert.deepEqual(r, []);
});

test('returns singleton attribute when another appears twice', () => {
  const r = singletonValues({ o1: ['a', 'b'], o2: ['b'] });
  assert.deepEqual(r, ["a"]);
});

test('returns sorted singletons from multiple objects', () => {
  const r = singletonValues({ o1: ['c', 'a'], o2: ['b', 'a'] });
  assert.deepEqual(r, ["b", "c"]);
});

test('returns empty array when all attributes appear twice', () => {
  const r = singletonValues({ o1: ['x', 'y'], o2: ['x', 'y'] });
  assert.deepEqual(r, []);
});

test('returns singleton for attribute appearing once among many', () => {
  const r = singletonValues({ o1: ['a'], o2: ['b'], o3: ['a', 'b'] });
  assert.deepEqual(r, []);
});

test('returns empty array when attribute appears three times', () => {
  const r = singletonValues({ o1: ['a'], o2: ['a'], o3: ['a'] });
  assert.deepEqual(r, []);
});
