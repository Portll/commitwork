// Coerces a value to its string representation (lib/actions-expressions.mjs coerceString).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceString } from '../actions-expressions.mjs';

test('returns empty string for null', () => {
  assert.equal(coerceString(null), '');
});

test('returns empty string for undefined', () => {
  assert.equal(coerceString(undefined), '');
});

test('returns true for boolean true', () => {
  assert.equal(coerceString(true), 'true');
});

test('returns false for boolean false', () => {
  assert.equal(coerceString(false), 'false');
});

test('returns 0 for number zero', () => {
  assert.equal(coerceString(0), '0');
});

test('returns stringified number for non-zero number', () => {
  assert.equal(coerceString(42), '42');
  assert.equal(coerceString(1), '1');
});

test('returns stringified number for negative number', () => {
  assert.equal(coerceString(-3.14), '-3.14');
});

test('returns the same string for string input', () => {
  assert.equal(coerceString('hello'), 'hello');
});

test('returns Array for array input', () => {
  assert.equal(coerceString([1, 2, 3]), 'Array');
});

test('returns Object for object input', () => {
  assert.equal(coerceString({ a: 1 }), 'Object');
});
