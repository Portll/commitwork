// Filters pairs to those whose direction exists in the subs set, preserving order (bin/taxonomy-lattice.mjs orderedDistinct).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderedDistinct } from '../taxonomy-lattice.mjs';

test('returns empty array when subs is empty', () => {
  const r = orderedDistinct([['a', 'b']], []);
  assert.deepEqual(r, []);
});

test('returns empty array when pairs is empty', () => {
  const r = orderedDistinct([], [['a', 'b']]);
  assert.deepEqual(r, []);
});

test('includes pair when direction matches subs', () => {
  const r = orderedDistinct([['a', 'b']], [['a', 'b']]);
  assert.deepEqual(r, [["a", "b"]]);
});

test('includes reversed pair when reverse direction matches subs', () => {
  const r = orderedDistinct([['a', 'b']], [['b', 'a']]);
  assert.deepEqual(r, [["b", "a"]]);
});

test('includes both directions when both exist in subs', () => {
  const r = orderedDistinct([['a', 'b']], [['a', 'b'], ['b', 'a']]);
  assert.deepEqual(r, [["a", "b"], ["b", "a"]]);
});

test('excludes pair when neither direction is in subs', () => {
  const r = orderedDistinct([['a', 'b']], [['c', 'd']]);
  assert.deepEqual(r, []);
});

test('excludes pair when subs has similar but non-matching separator', () => {
  const r = orderedDistinct([['a', 'b']], [['a>=b']]);
  assert.deepEqual(r, []);
});

test('handles multiple pairs with mixed matches', () => {
  const r = orderedDistinct([['a', 'b'], ['c', 'd'], ['e', 'f']], [['a', 'b'], ['d', 'c']]);
  assert.deepEqual(r, [["a", "b"], ["d", "c"]]);
});

test('distinguishes strings where one is prefix of another with separator', () => {
  const r = orderedDistinct([['a', 'b']], [['a>', 'b']]);
  assert.deepEqual(r, []);
});

test('handles self-pair where both directions are same', () => {
  const r = orderedDistinct([['x', 'x']], [['x', 'x']]);
  assert.deepEqual(r, [["x", "x"], ["x", "x"]]);
});
