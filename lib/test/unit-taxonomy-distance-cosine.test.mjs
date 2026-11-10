// Dot product of two sparse weight maps over their shared keys (lib/taxonomy-distance.mjs cosine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosine } from '../taxonomy-distance.mjs';

test('returns zero when the two maps share no keys', () => {
  const a = new Map([['x', 1]]);
  const b = new Map([['y', 2]]);
  assert.equal(cosine(a, b), 0);
});

test('returns the product of weights when both maps share a single key', () => {
  const a = new Map([['k', 3]]);
  const b = new Map([['k', 4]]);
  assert.equal(cosine(a, b), 12);
});

test('sums products across multiple shared keys when sizes are equal', () => {
  const a = new Map([['a', 1], ['b', 2]]);
  const b = new Map([['a', 10], ['b', 20]]);
  assert.equal(cosine(a, b), 50);
});

test('iterates the first map when it is one entry smaller than the second', () => {
  const a = new Map([['a', 1], ['b', 2]]);
  const b = new Map([['a', 10], ['b', 20], ['c', 30]]);
  assert.equal(cosine(a, b), 50);
});

test('iterates the second map when the first is one entry larger', () => {
  const a = new Map([['a', 10], ['b', 20], ['c', 30]]);
  const b = new Map([['a', 1], ['b', 2]]);
  assert.equal(cosine(a, b), 50);
});

test('returns zero when both maps are empty', () => {
  assert.equal(cosine(new Map(), new Map()), 0);
});

test('returns zero when one map is empty and the other has entries', () => {
  const a = new Map();
  const b = new Map([['x', 5]]);
  assert.equal(cosine(a, b), 0);
});

test('handles negative weights in the dot product', () => {
  const a = new Map([['a', -1], ['b', 2]]);
  const b = new Map([['a', 3], ['b', -4]]);
  assert.equal(cosine(a, b), -11);
});

test('with equal sizes it iterates the first map so a NaN weight there yields NaN', () => {
  const a = new Map([['k', NaN]]);
  const b = new Map([['k', 2]]);
  assert.equal(cosine(a, b), NaN);
});

test('with equal sizes it sums in the first map key order', () => {
  const a = new Map([['x', 0.1], ['y', 0.2], ['z', 0.3]]);
  const b = new Map([['z', 1], ['y', 1], ['x', 1]]);
  assert.equal(cosine(a, b), 0.6000000000000001);
});
