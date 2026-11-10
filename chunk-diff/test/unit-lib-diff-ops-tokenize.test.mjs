// Splits text into whitespace and non-whitespace tokens (chunk-diff/lib/diff-ops.mjs tokenize).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from '../lib/diff-ops.mjs';

test('returns empty array for empty string', () => {
  const r = tokenize('');
  assert.deepEqual(r, []);
});

test('returns single token for non-whitespace text', () => {
  const r = tokenize('hello');
  assert.deepEqual(r, ["hello"]);
});

test('returns whitespace token for single space', () => {
  const r = tokenize(' ');
  assert.deepEqual(r, [" "]);
});

test('returns multiple tokens for mixed text', () => {
  const r = tokenize('a b c');
  assert.deepEqual(r, ["a", " ", "b", " ", "c"]);
});

test('returns consecutive whitespace as one token', () => {
  const r = tokenize('a   b');
  assert.deepEqual(r, ["a", "   ", "b"]);
});

test('handles leading and trailing whitespace', () => {
  const r = tokenize('  hello  ');
  assert.deepEqual(r, ["  ", "hello", "  "]);
});

test('handles newlines and tabs as whitespace', () => {
  const r = tokenize('a\nb\tc');
  assert.deepEqual(r, ["a", "\n", "b", "\t", "c"]);
});

test('handles repeated characters with spaces', () => {
  const r = tokenize('x'.repeat(5) + ' ' + 'y'.repeat(3));
  assert.deepEqual(r, ["xxxxx", " ", "yyy"]);
});
