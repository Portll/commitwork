// Finds name and prefix spans in release scope text (bin/lib/release-scope.mjs findNames).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findNames } from '../lib/release-scope.mjs';

test('returns empty array for non-string input', () => {
  assert.deepEqual(findNames(123, { words: [] }), []);
});

test('returns empty array for empty string', () => {
  assert.deepEqual(findNames('', { words: [] }), []);
});

test('returns empty array when no words match', () => {
  assert.deepEqual(findNames('hello world', { words: [{ key: 'foo', re: /foo/g, short: false, exempt: [], source: 's' }] }), []);
});

test('finds a word match with correct span', () => {
  assert.deepEqual(findNames('hello world', { words: [{ key: 'world', re: /world/g, short: false, exempt: [], source: 's' }] }), [{ start: 6, end: 11, source: "s", kind: "name" }]);
});

test('skips short word match when not at word edge', () => {
  assert.deepEqual(findNames('xworld', { words: [{ key: 'world', re: /world/g, short: true, exempt: [], source: 's' }] }), []);
});

test('includes short word match at word edge', () => {
  assert.deepEqual(findNames('world', { words: [{ key: 'world', re: /world/g, short: true, exempt: [], source: 's' }] }), [{ start: 0, end: 5, source: "s", kind: "name" }]);
});

test('skips match covered by exempt word', () => {
  assert.deepEqual(findNames('world', { words: [{ key: 'world', re: /world/g, short: false, exempt: ['world'], source: 's' }] }), []);
});

test('includes match not covered by exempt word', () => {
  assert.deepEqual(findNames('world', { words: [{ key: 'world', re: /world/g, short: false, exempt: ['foo'], source: 's' }] }), [{ start: 0, end: 5, source: "s", kind: "name" }]);
});

test('finds prefix match with identity-register source', () => {
  assert.deepEqual(findNames('abc123', { words: [], prefixRe: /abc\d+/g, prefixes: [] }), [{ start: 0, end: 6, source: "identity-register", kind: "prefix" }]);
});

test('merges overlapping spans', () => {
  assert.deepEqual(findNames('abab', { words: [
    { key: 'ab', re: /ab/g, short: false, exempt: [], source: 's1' },
    { key: 'ba', re: /ba/g, short: false, exempt: [], source: 's2' }
  ] }), [{ start: 0, end: 4, source: "s1", kind: "name" }]);
});
