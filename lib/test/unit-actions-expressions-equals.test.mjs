// Case-insensitive equality with type coercion (lib/actions-expressions.mjs equals).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { equals } from '../actions-expressions.mjs';

test('returns true for identical numbers', () => {
  assert.equal(equals(1, 1), true);
});

test('returns true for number and numeric string', () => {
  assert.equal(equals(1, '1'), true);
});

test('returns false for number and non-numeric string', () => {
  assert.equal(equals(1, 'a'), false);
});

test('returns true for case-insensitive strings', () => {
  assert.equal(equals('Hello', 'hello'), true);
});

test('returns true for null and undefined', () => {
  assert.equal(equals(null, undefined), true);
});

test('returns true for boolean and equivalent number', () => {
  assert.equal(equals(true, 1), true);
});

test('compares a boolean with a number or a boolean by value', () => {
  assert.equal(equals(true, 0), false);
  assert.equal(equals(true, true), true);
  assert.equal(equals(false, true), false);
});

test('returns false for different arrays and for an array against a number', () => {
  assert.equal(equals([1, 2], [1, 3]), false);
  assert.equal(equals([1], 1), false);
});

test('returns false for NaN and number', () => {
  assert.equal(equals(NaN, 1), false);
});
