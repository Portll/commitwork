// Listed pairs whose objects share an identical attribute set (bin/taxonomy-lattice.mjs collisions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collisions } from '../taxonomy-lattice.mjs';

test('returns an empty array when no pairs are given', () => {
  const objects = { a: ['x'], b: ['x'] };
  assert.deepEqual(collisions([], objects), []);
});

test('returns the pair when both members have the same attributes', () => {
  const objects = { a: ['x'], b: ['x'] };
  assert.deepEqual(collisions([['a', 'b']], objects), [['a', 'b']]);
});

test('keeps the order of the pair members as given', () => {
  const objects = { a: ['x', 'y'], b: ['x', 'y'] };
  assert.deepEqual(collisions([['b', 'a']], objects), [['b', 'a']]);
});

test('returns an empty array when the pair members have different attributes', () => {
  const objects = { a: ['x'], b: ['y'] };
  assert.deepEqual(collisions([['a', 'b']], objects), []);
});

test('skips a distinguishable pair even when the first member collides with another object', () => {
  const objects = { a: ['x'], c: ['x'], b: ['y'] };
  assert.deepEqual(collisions([['a', 'b']], objects), []);
});

test('returns only the colliding pair among several pairs', () => {
  const objects = { a: ['x'], b: ['x'], c: ['y'] };
  assert.deepEqual(collisions([['a', 'b'], ['a', 'c'], ['b', 'c']], objects), [['a', 'b']]);
});

test('skips a pair whose second member is not in the objects', () => {
  const objects = { a: ['x'], c: ['x'] };
  assert.deepEqual(collisions([['a', 'b']], objects), []);
});

test('skips a pair whose first member is not in the objects', () => {
  const objects = { b: ['x'], c: ['x'] };
  assert.deepEqual(collisions([['a', 'b']], objects), []);
});

test('skips a pair when neither member is in the objects', () => {
  const objects = { c: ['x'], d: ['x'] };
  assert.deepEqual(collisions([['a', 'b']], objects), []);
});

test('reports every colliding pair from a larger group of identical objects', () => {
  const ids = Array.from({ length: 4 }, (_, i) => 'o' + i);
  const objects = Object.fromEntries(ids.map((id) => [id, ['k']]));
  const pairs = [['o0', 'o1'], ['o2', 'o3'], ['o1', 'o9']];
  assert.deepEqual(collisions(pairs, objects), [['o0', 'o1'], ['o2', 'o3']]);
});
