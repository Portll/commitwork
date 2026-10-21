// Classifies a value into a string kind (lib/actions-expressions.mjs kindOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, Dict } from '../actions-expressions.mjs';

test('returns null for null input', () => {
  assert.equal(kindOf(null), 'null');
});

test('returns null for undefined input', () => {
  assert.equal(kindOf(undefined), 'null');
});

test('returns dict for Dict instance', () => {
  const d = new Dict();
  assert.equal(kindOf(d), 'dict');
});

test('returns array for empty array', () => {
  assert.equal(kindOf([]), 'array');
});

test('returns array for non-empty array', () => {
  assert.equal(kindOf([1, 2, 3]), 'array');
});

test('returns string for string value', () => {
  assert.equal(kindOf('hello'), 'string');
});

test('returns number for number value', () => {
  assert.equal(kindOf(42), 'number');
});

test('returns boolean for true', () => {
  assert.equal(kindOf(true), 'boolean');
});

test('returns boolean for false', () => {
  assert.equal(kindOf(false), 'boolean');
});

test('returns object for plain object', () => {
  assert.equal(kindOf({}), 'object');
});
