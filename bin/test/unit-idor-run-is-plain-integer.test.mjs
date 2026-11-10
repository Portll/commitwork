// Checks if a value is a non-negative integer string (bin/idor-run.mjs isPlainInteger).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlainInteger } from '../idor-run.mjs';

test('returns true for a simple digit string', () => {
  assert.equal(isPlainInteger('123'), true);
});

test('returns true for a single zero', () => {
  assert.equal(isPlainInteger('0'), true);
});

test('returns false for a negative number string', () => {
  assert.equal(isPlainInteger('-1'), false);
});

test('returns false for a decimal number string', () => {
  assert.equal(isPlainInteger('1.5'), false);
});

test('returns false for an empty string', () => {
  assert.equal(isPlainInteger(''), false);
});

test('returns false for null input', () => {
  assert.equal(isPlainInteger(null), false);
});

test('returns false for undefined input', () => {
  assert.equal(isPlainInteger(undefined), false);
});

test('returns false for a string with a leading space', () => {
  assert.equal(isPlainInteger(' 123'), false);
});

test('returns false for a string with a trailing space', () => {
  assert.equal(isPlainInteger('123 '), false);
});

test('returns false for a non-numeric string', () => {
  assert.equal(isPlainInteger('abc'), false);
});
