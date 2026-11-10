// Whether a string has non-whitespace content (lib/untrusted-text.mjs worthFencing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worthFencing } from '../untrusted-text.mjs';

test('returns true for a non-empty string with content', () => {
  const r = worthFencing('hello');
  assert.equal(r, true);
});

test('returns false for an empty string', () => {
  const r = worthFencing('');
  assert.equal(r, false);
});

test('returns false for a whitespace-only string', () => {
  const r = worthFencing('   ');
  assert.equal(r, false);
});

test('returns false for a single space string', () => {
  const r = worthFencing(' ');
  assert.equal(r, false);
});

test('returns false for a number input', () => {
  const r = worthFencing(42);
  assert.equal(r, false);
});

test('returns false for a null input', () => {
  const r = worthFencing(null);
  assert.equal(r, false);
});

test('returns false for an undefined input', () => {
  const r = worthFencing(undefined);
  assert.equal(r, false);
});

test('returns true for a string with leading and trailing whitespace', () => {
  const r = worthFencing('  hello  ');
  assert.equal(r, true);
});
