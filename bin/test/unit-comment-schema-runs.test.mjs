// Finds contiguous blocks of non-empty comment lines as {start, len} runs (bin/comment-schema.mjs runs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runs } from '../comment-schema.mjs';

test('returns empty array for empty input', () => {
  assert.deepEqual(runs([]), []);
});

test('returns empty array when all lines are null', () => {
  assert.deepEqual(runs([null, null, null]), []);
});

test('returns empty array when all lines are empty strings', () => {
  assert.deepEqual(runs(['', '', '']), []);
});

test('returns single block for single non-empty line', () => {
  assert.deepEqual(runs(['a']), [{ start: 0, len: 1 }]);
});

test('returns single block for consecutive non-empty lines', () => {
  assert.deepEqual(runs(['a', 'b', 'c']), [{ start: 0, len: 3 }]);
});

test('returns two blocks separated by a null line', () => {
  assert.deepEqual(runs(['a', null, 'b']), [{ start: 0, len: 1 }, { start: 2, len: 1 }]);
});

test('returns two blocks separated by an empty string line', () => {
  assert.deepEqual(runs(['a', '', 'b']), [{ start: 0, len: 1 }, { start: 2, len: 1 }]);
});

test('returns two blocks separated by multiple blank lines', () => {
  assert.deepEqual(runs(['a', null, '', 'b']), [{ start: 0, len: 1 }, { start: 3, len: 1 }]);
});

test('returns block with correct start and len when preceded by blanks', () => {
  assert.deepEqual(runs([null, '', 'x', 'y']), [{ start: 2, len: 2 }]);
});

test('returns multiple blocks with mixed separators', () => {
  assert.deepEqual(runs(['a', 'b', null, 'c', '', 'd', 'e']), [
    { start: 0, len: 2 },
    { start: 3, len: 1 },
    { start: 5, len: 2 }
  ]);
});
