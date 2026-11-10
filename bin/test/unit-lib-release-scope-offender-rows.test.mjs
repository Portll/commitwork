// Aggregates hit counts per masked path and line, appending a multiplier when a key repeats. (bin/lib/release-scope.mjs offenderRows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offenderRows } from '../lib/release-scope.mjs';

const scope = { words: [], prefixRe: null, prefixes: [] };

test('returns an empty array when there is no content', () => {
  assert.deepEqual(offenderRows([], scope), []);
});

test('returns the key without a multiplier when a key appears once', () => {
  const content = [{ path: 'a', hits: [{ line: 1, source: 's', kind: 'name' }] }];
  assert.deepEqual(offenderRows(content, scope), ["a:1 (s, name)"]);
});

test('appends a multiplier when the same key appears twice', () => {
  const content = [
    { path: 'a', hits: [{ line: 1, source: 's', kind: 'name' }] },
    { path: 'a', hits: [{ line: 1, source: 's', kind: 'name' }] },
  ];
  assert.deepEqual(offenderRows(content, scope), ["a:1 (s, name) x2"]);
});

test('appends a multiplier when the same key appears three times', () => {
  const content = [
    { path: 'a', hits: [{ line: 1, source: 's', kind: 'name' }] },
    { path: 'a', hits: [{ line: 1, source: 's', kind: 'name' }] },
    { path: 'a', hits: [{ line: 1, source: 's', kind: 'name' }] },
  ];
  assert.deepEqual(offenderRows(content, scope), ["a:1 (s, name) x3"]);
});

test('keeps distinct keys separate without multipliers', () => {
  const content = [
    { path: 'a', hits: [{ line: 1, source: 's', kind: 'name' }] },
    { path: 'b', hits: [{ line: 2, source: 't', kind: 'prefix' }] },
  ];
  assert.deepEqual(offenderRows(content, scope), ["a:1 (s, name)", "b:2 (t, prefix)"]);
});

test('accumulates counts across multiple entries with the same key', () => {
  const content = [
    { path: 'a', hits: [{ line: 1, source: 's', kind: 'name' }, { line: 1, source: 's', kind: 'name' }] },
    { path: 'a', hits: [{ line: 1, source: 's', kind: 'name' }] },
  ];
  assert.deepEqual(offenderRows(content, scope), ["a:1 (s, name) x3"]);
});

test('distinguishes keys that differ only by line number', () => {
  const content = [
    { path: 'a', hits: [{ line: 1, source: 's', kind: 'name' }] },
    { path: 'a', hits: [{ line: 2, source: 's', kind: 'name' }] },
  ];
  assert.deepEqual(offenderRows(content, scope), ["a:1 (s, name)", "a:2 (s, name)"]);
});

test('distinguishes keys that differ only by source', () => {
  const content = [
    { path: 'a', hits: [{ line: 1, source: 's', kind: 'name' }] },
    { path: 'a', hits: [{ line: 1, source: 't', kind: 'name' }] },
  ];
  assert.deepEqual(offenderRows(content, scope), ["a:1 (s, name)", "a:1 (t, name)"]);
});

test('distinguishes keys that differ only by kind', () => {
  const content = [
    { path: 'a', hits: [{ line: 1, source: 's', kind: 'name' }] },
    { path: 'a', hits: [{ line: 1, source: 's', kind: 'prefix' }] },
  ];
  assert.deepEqual(offenderRows(content, scope), ["a:1 (s, name)", "a:1 (s, prefix)"]);
});

test('preserves insertion order of first appearance for distinct keys', () => {
  const content = [
    { path: 'z', hits: [{ line: 9, source: 's', kind: 'name' }] },
    { path: 'a', hits: [{ line: 1, source: 's', kind: 'name' }] },
    { path: 'm', hits: [{ line: 5, source: 's', kind: 'name' }] },
  ];
  assert.deepEqual(offenderRows(content, scope), ["z:9 (s, name)", "a:1 (s, name)", "m:5 (s, name)"]);
});
