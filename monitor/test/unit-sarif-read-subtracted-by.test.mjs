// Collects the uris that match any failed uri via sameFile (monitor/sarif-read.mjs subtractedBy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subtractedBy } from '../sarif-read.mjs';

test('returns an empty set when failedUris is empty', () => {
  const r = subtractedBy([], ['a/b.js', 'a/c.js']);
  assert.deepEqual(r, new Set([]));
});

test('returns an empty set when uris is empty', () => {
  const r = subtractedBy(['a/b.js'], []);
  assert.deepEqual(r, new Set([]));
});

test('returns the failed uri itself when it is present in uris', () => {
  const r = subtractedBy(['a/b.js'], ['a/b.js', 'a/c.js']);
  assert.deepEqual(r, new Set(["a/b.js"]));
});

test('returns the matching uri when failed uri is a prefix path of a uri', () => {
  const r = subtractedBy(['a/b.js'], ['x/a/b.js', 'y/c.js']);
  assert.deepEqual(r, new Set(["x/a/b.js"]));
});

test('returns an empty set when no uri matches the failed uri', () => {
  const r = subtractedBy(['a/b.js'], ['a/c.js', 'b/b.js']);
  assert.deepEqual(r, new Set([]));
});

test('returns multiple uris when several match the failed uri', () => {
  const r = subtractedBy(['a/b.js'], ['x/a/b.js', 'y/a/b.js', 'z/c.js']);
  assert.deepEqual(r, new Set([]));
});

test('deduplicates uris that match multiple failed uris', () => {
  const r = subtractedBy(['a/b.js', 'x/a/b.js'], ['x/a/b.js', 'y/a/b.js']);
  assert.deepEqual(r, new Set(["x/a/b.js"]));
});

test('returns an empty set when a failed uri matches multiple uris', () => {
  const r = subtractedBy(['a/b.js'], ['x/a/b.js', 'y/a/b.js']);
  assert.deepEqual(r, new Set([]));
});
