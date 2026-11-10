// Extracts the longest opaque token of at least 12 chars from a matched line (admin/routes/leaks-verify.mjs traceToken).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traceToken } from '../routes/leaks-verify.mjs';

test('returns null for empty string', () => {
  assert.equal(traceToken(''), null);
});

test('returns null for null input', () => {
  assert.equal(traceToken(null), null);
});

test('returns null for undefined input', () => {
  assert.equal(traceToken(undefined), null);
});

test('returns null when all tokens are shorter than 12 chars', () => {
  assert.equal(traceToken('abc def ghi'), null);
});

test('returns the single token when it is exactly 12 chars', () => {
  assert.equal(traceToken('abcdefghijkl'), 'abcdefghijkl');
});

test('returns the single token when it is longer than 12 chars', () => {
  assert.equal(traceToken('a'.repeat(20)), 'a'.repeat(20));
});

test('returns the longest token when multiple tokens exceed 12 chars', () => {
  const short = 'b'.repeat(12);
  const long = 'c'.repeat(15);
  assert.equal(traceToken(`${short} ${long}`), long);
});

test('returns the longest token when lengths are equal', () => {
  const a = 'd'.repeat(12);
  const b = 'e'.repeat(12);
  assert.equal(traceToken(`${a} ${b}`), a);
});

test('handles tokens separated by punctuation delimiters', () => {
  const token = 'f'.repeat(14);
  assert.equal(traceToken(`"${token}"`), token);
});

test('returns null when token is exactly 11 chars (below minimum)', () => {
  assert.equal(traceToken('a'.repeat(11)), null);
});
