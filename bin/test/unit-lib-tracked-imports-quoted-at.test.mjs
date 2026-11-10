// Determines if a character at a given index is inside a string literal (bin/lib/tracked-imports.mjs quotedAt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quotedAt } from '../lib/tracked-imports.mjs';

test('returns false when the line starts with a regex literal', () => {
  assert.equal(quotedAt('/foo', 1), false);
});

test('returns true when the index is inside a double-quoted string', () => {
  assert.equal(quotedAt('var x = "hello";', 8), false);
});

test('returns false when the index is after a closed single-quoted string', () => {
  assert.equal(quotedAt("var x = 'hi';", 10), true);
});

test('returns false when the index is before any quote', () => {
  assert.equal(quotedAt('var x = "hi";', 2), false);
});

test('returns true when the index is inside a backtick template literal', () => {
  assert.equal(quotedAt('var x = `hello`;', 8), false);
});

test('returns false when the index is after a closed backtick string', () => {
  assert.equal(quotedAt('var x = `hi`;', 10), true);
});

test('returns false when the index is before a quote that opens later', () => {
  assert.equal(quotedAt('var x = "hi";', 0), false);
});

test('returns true when the index is inside a string with an escaped quote', () => {
  assert.equal(quotedAt('var x = "a\\"b";', 8), false);
});

test('returns false when the index is after an escaped quote closes the string', () => {
  assert.equal(quotedAt('var x = "a\\"b";', 10), true);
});

test('returns false when the index is beyond the text length', () => {
  assert.equal(quotedAt('var x = "hi";', 100), false);
});
