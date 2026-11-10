// Extracts fact entries from a comment block (bin/comment-suggest.mjs asFacts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asFacts } from '../comment-suggest.mjs';

test('returns null when fewer than two fact lines are present', () => {
  assert.equal(asFacts(['fact: one']), null);
});

test('returns null when the first line is not a fact line', () => {
  assert.equal(asFacts(['note: x', 'fact: a', 'fact: b']), null);
});

test('returns entries when there are exactly two fact lines', () => {
  assert.deepEqual(asFacts(['fact: a', 'fact: b']), ['a', 'b']);
});

test('returns entries when there are three fact lines', () => {
  assert.deepEqual(asFacts(['fact: a', 'fact: b', 'fact: c']), ['a', 'b', 'c']);
});

test('returns entries when the second line is not a fact line', () => {
  assert.deepEqual(asFacts(['fact: a', 'note: x', 'fact: b']), ['a note: x', 'b']);
});

test('appends continuation lines to the current entry when open is true', () => {
  assert.deepEqual(asFacts(['fact: a', 'continuation']), null);
});

test('does not append continuation lines when open is false', () => {
  assert.deepEqual(asFacts(['fact: a (expiry:2025)', 'continuation']), null);
});

test('closes the entry when an expiry marker is present', () => {
  assert.deepEqual(asFacts(['fact: a (expiry:2025)', 'fact: b']), ['a (expiry:2025)', 'b']);
});

test('keeps open state true after an entry without expiry', () => {
  assert.deepEqual(asFacts(['fact: a', 'fact: b', 'continuation']), ['a', 'b continuation']);
});

test('handles multiple entries with mixed expiry and continuation', () => {
  assert.deepEqual(asFacts(['fact: a (expiry:2025)', 'fact: b', 'continuation']), ['a (expiry:2025)', 'b continuation']);
});
