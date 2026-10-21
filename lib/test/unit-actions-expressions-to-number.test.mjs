// Converts a value to a number, mapping null to 0, booleans to 1 or 0, strings via Number, and other types to NaN (lib/actions-expressions.mjs toNumber).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toNumber } from '../actions-expressions.mjs';

test('returns 0 for null', () => {
  assert.equal(toNumber(null), 0);
});

test('returns 0 for undefined', () => {
  assert.equal(toNumber(undefined), 0);
});

test('returns 1 for true', () => {
  assert.equal(toNumber(true), 1);
});

test('returns 0 for false', () => {
  assert.equal(toNumber(false), 0);
});

test('returns the same number for a number input', () => {
  assert.equal(toNumber(42), 42);
  assert.equal(toNumber(-3.5), -3.5);
  assert.equal(toNumber(0), 0);
});

test('parses numeric strings to their numeric value', () => {
  assert.equal(toNumber('42'), 42);
  assert.equal(toNumber('-3.5'), -3.5);
  assert.equal(toNumber('0'), 0);
});

test('returns NaN for non-numeric strings', () => {
  assert.ok(Number.isNaN(toNumber('abc')));
});

test('returns NaN for objects', () => {
  assert.ok(Number.isNaN(toNumber({})));
});

test('returns NaN for arrays', () => {
  assert.ok(Number.isNaN(toNumber([1, 2, 3])));
});
