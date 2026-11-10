// Redacts high-entropy alphanumeric runs in text (bin/lib/pattern-core.mjs redactSnippet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSnippet } from '../lib/pattern-core.mjs';

test('returns empty text and zero redactions for null input', () => {
  const r = redactSnippet(null);
  assert.deepEqual(r, { text: "", redacted: 0 });
});

test('returns empty text and zero redactions for empty string', () => {
  const r = redactSnippet('');
  assert.deepEqual(r, { text: "", redacted: 0 });
});

test('preserves short runs below the minimum length threshold', () => {
  const r = redactSnippet('abc123');
  assert.deepEqual(r, { text: "abc123", redacted: 0 });
});

test('preserves runs exactly at the minimum length threshold', () => {
  const r = redactSnippet('a'.repeat(20));
  assert.deepEqual(r, { text: "aaaaaaaaaaaaaaaaaaaa", redacted: 0 });
});

test('preserves runs just above the minimum length threshold with low entropy', () => {
  const r = redactSnippet('a'.repeat(21));
  assert.deepEqual(r, { text: "aaaaaaaaaaaaaaaaaaaaa", redacted: 0 });
});

test('redacts high-entropy runs above the minimum length threshold', () => {
  const r = redactSnippet('a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ');
  assert.deepEqual(r, { text: "\u27e8redacted:36c\u27e9", redacted: 1 });
});

test('preserves repository digest patterns', () => {
  const r = redactSnippet('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0');
  assert.deepEqual(r, { text: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0", redacted: 0 });
});

test('preserves identifier-like patterns', () => {
  const r = redactSnippet('myVariableNameIsQuiteLongHere1234567890');
  assert.deepEqual(r, { text: "myVariableNameIsQuiteLongHere1234567890", redacted: 0 });
});

test('preserves placeholder patterns', () => {
  const r = redactSnippet('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  assert.deepEqual(r, { text: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", redacted: 0 });
});

test('redacts multiple high-entropy runs in a single text', () => {
  const r = redactSnippet('a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ and a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ');
  assert.deepEqual(r, { text: "\u27e8redacted:36c\u27e9 and \u27e8redacted:36c\u27e9", redacted: 2 });
});
