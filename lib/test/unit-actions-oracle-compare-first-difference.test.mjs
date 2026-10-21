// Finds the first structural difference between two values (lib/actions-oracle-compare.mjs firstDifference).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstDifference } from '../actions-oracle-compare.mjs';

test('returns undefined when both values are identical primitives', () => {
  assert.equal(firstDifference(1, 1), undefined);
});

test('returns a string describing the difference when primitives differ', () => {
  assert.equal(firstDifference(1, 2), '$: 1 vs 2');
});

test('returns undefined when both values are NaN', () => {
  assert.equal(firstDifference(NaN, NaN), undefined);
});

test('returns a string when one value is NaN and the other is not', () => {
  assert.equal(firstDifference(NaN, 1), '$: null vs 1');
});

test('returns undefined when both arrays are empty', () => {
  assert.equal(firstDifference([], []), undefined);
});

test('returns a string describing length mismatch when array lengths differ', () => {
  assert.equal(firstDifference([1], [1, 2]), '$: length 1 vs 2');
});

test('returns a string describing element difference when array elements differ', () => {
  assert.equal(firstDifference([1, 2], [1, 3]), '$[1]: 2 vs 3');
});

test('returns undefined when both objects are empty', () => {
  assert.equal(firstDifference({}, {}), undefined);
});

test('returns a string describing missing key when objects have different keys', () => {
  assert.equal(firstDifference({ a: 1 }, { a: 1, b: 2 }), '$.b: undefined vs 2');
});

test('returns a string describing value difference when object values differ', () => {
  assert.equal(firstDifference({ a: 1 }, { a: 2 }), '$.a: 1 vs 2');
});

test('returns a string when one argument is an array and the other is a primitive', () => {
  assert.equal(firstDifference([1], 1), '$: [1] vs 1');
});

test('returns a string when one argument is a primitive and the other is an array', () => {
  assert.equal(firstDifference(1, [1]), '$: 1 vs [1]');
});

test('returns a string when one argument is an object and the other is a primitive', () => {
  assert.equal(firstDifference({ a: 1 }, 1), '$: {"a":1} vs 1');
});

test('returns a string when one argument is a primitive and the other is an object', () => {
  assert.equal(firstDifference(1, { a: 1 }), '$: 1 vs {"a":1}');
});

test('returns undefined when both arrays have the same length and identical elements', () => {
  assert.equal(firstDifference([1, 2, 3], [1, 2, 3]), undefined);
});

test('returns a string describing the first differing element in a longer array', () => {
  assert.equal(firstDifference([1, 2, 3], [1, 2, 4]), '$[2]: 3 vs 4');
});

test('returns a string describing the first differing element at index zero', () => {
  assert.equal(firstDifference([1, 2], [2, 2]), '$[0]: 1 vs 2');
});

test('returns undefined when both objects have the same keys and identical values', () => {
  assert.equal(firstDifference({ a: 1, b: 2 }, { a: 1, b: 2 }), undefined);
});

test('returns a string describing the first differing key in object comparison', () => {
  assert.equal(firstDifference({ a: 1, b: 2 }, { a: 1, b: 3 }), '$.b: 2 vs 3');
});

test('returns a string describing the first differing key at the first position', () => {
  assert.equal(firstDifference({ a: 1, b: 2 }, { a: 2, b: 2 }), '$.a: 1 vs 2');
});

test('returns a string when one argument is null and the other is an object', () => {
  assert.equal(firstDifference(null, { a: 1 }), '$: null vs {"a":1}');
});

test('returns a string when one argument is an object and the other is null', () => {
  assert.equal(firstDifference({ a: 1 }, null), '$: {"a":1} vs null');
});

test('returns a string when one argument is null and the other is an array', () => {
  assert.equal(firstDifference(null, [1]), '$: null vs [1]');
});

test('returns a string when one argument is an array and the other is null', () => {
  assert.equal(firstDifference([1], null), '$: [1] vs null');
});
