// Computes pairs of objects where one attribute set strictly contains another (bin/taxonomy-lattice.mjs subsumptions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subsumptions } from '../taxonomy-lattice.mjs';

test('returns empty array when there are no objects', () => {
  assert.deepEqual(subsumptions({}), []);
});

test('returns empty array when all objects have identical attribute sets', () => {
  const objects = { a: ['x'], b: ['x'] };
  assert.deepEqual(subsumptions(objects), []);
});

test('returns empty array when no object strictly contains another', () => {
  const objects = { a: ['x'], b: ['y'] };
  assert.deepEqual(subsumptions(objects), []);
});

test('returns pair when one object strictly contains another', () => {
  const objects = { a: ['x', 'y'], b: ['x'] };
  assert.deepEqual(subsumptions(objects), [["a", "b"]]);
});

test('returns empty array when sets have equal size but different content', () => {
  const objects = { a: ['x', 'y'], b: ['x', 'z'] };
  assert.deepEqual(subsumptions(objects), []);
});

test('returns empty array when larger set does not contain all elements of smaller set', () => {
  const objects = { a: ['x', 'y'], b: ['x', 'z'] };
  assert.deepEqual(subsumptions(objects), []);
});

test('returns multiple pairs when multiple objects contain others', () => {
  const objects = { a: ['x', 'y', 'z'], b: ['x', 'y'], c: ['x'] };
  assert.deepEqual(subsumptions(objects), [["a", "b"], ["a", "c"], ["b", "c"]]);
});

test('returns empty array for single object', () => {
  const objects = { a: ['x', 'y'] };
  assert.deepEqual(subsumptions(objects), []);
});
