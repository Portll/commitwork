// Names not present in the last full run (bin/lib/test-selection.mjs freshFailures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshFailures } from '../lib/test-selection.mjs';

test('returns empty array when names is empty', () => {
  assert.deepEqual(freshFailures([], ['a', 'b']), []);
});

test('returns empty array when all names are in lastFullNames', () => {
  assert.deepEqual(freshFailures(['a', 'b', 'c'], ['a', 'b', 'c']), []);
});

test('returns all names when lastFullNames is empty', () => {
  assert.deepEqual(freshFailures(['a', 'b', 'c'], []), ["a", "b", "c"]);
});

test('returns only names not in lastFullNames', () => {
  assert.deepEqual(freshFailures(['a', 'b', 'c', 'd'], ['a', 'c']), ["b", "d"]);
});

test('deduplicates names before filtering', () => {
  assert.deepEqual(freshFailures(['a', 'a', 'b', 'b', 'c'], ['a']), ["b", "c"]);
});

test('returns single fresh name when others are known', () => {
  assert.deepEqual(freshFailures(['x', 'y', 'z'], ['x', 'y']), ["z"]);
});

test('handles single name not in lastFullNames', () => {
  assert.deepEqual(freshFailures(['only'], ['other']), ["only"]);
});

test('handles single name in lastFullNames', () => {
  assert.deepEqual(freshFailures(['known'], ['known']), []);
});
