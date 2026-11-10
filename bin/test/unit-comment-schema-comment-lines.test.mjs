// Extracts comment text from source lines, handling block and line comments (bin/comment-schema.mjs commentLines).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentLines } from '../comment-schema.mjs';

test('returns empty array for empty string', () => {
  assert.deepEqual(commentLines(''), [null]);
});

test('returns null for non-comment lines', () => {
  assert.deepEqual(commentLines('const x = 1;'), [null]);
});

test('extracts text from single-line block comment', () => {
  assert.deepEqual(commentLines('/* hello */'), ['hello']);
});

test('extracts text from single-line block comment with multiple asterisks', () => {
  assert.deepEqual(commentLines('/** hello */'), ['hello']);
});

test('extracts text from line comment', () => {
  assert.deepEqual(commentLines('// hello'), ['hello']);
});

test('extracts text from line comment with multiple slashes', () => {
  assert.deepEqual(commentLines('// hello'), ['hello']);
});

test('handles multi-line block comment start', () => {
  assert.deepEqual(commentLines('/* hello\nworld */'), ['hello', 'world']);
});

test('handles multi-line block comment with asterisk prefix', () => {
  assert.deepEqual(commentLines('/* hello\n * world\n */'), ["hello", "world", "/"]);
});

test('handles code after block comment on same line', () => {
  assert.deepEqual(commentLines('/* hello */ code'), ['hello']);
});

test('handles mixed comments and code', () => {
  const src = '/* a */\n// b\ncode\n/* c\nd */\ne';
  assert.deepEqual(commentLines(src), ['a', 'b', null, 'c', 'd', null]);
});
