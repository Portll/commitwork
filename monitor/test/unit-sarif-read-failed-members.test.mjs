// Returns the single matching URI from a list when exactly one matches the failed URI (monitor/sarif-read.mjs failedMembers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failedMembers } from '../sarif-read.mjs';

test('returns the failed URI when it is directly included in the list', () => {
  const r = failedMembers('a/b.js', ['a/b.js', 'c/d.js']);
  assert.deepEqual(r, ["a/b.js"]);
});

test('returns the single matching URI when one list entry matches via suffix', () => {
  const r = failedMembers('a/b.js', ['x/a/b.js', 'y/c.js']);
  assert.deepEqual(r, ["x/a/b.js"]);
});

test('returns an empty array when two list entries match the failed URI', () => {
  const r = failedMembers('a/b.js', ['x/a/b.js', 'y/a/b.js']);
  assert.deepEqual(r, []);
});

test('returns an empty array when no list entry matches the failed URI', () => {
  const r = failedMembers('a/b.js', ['x/c.js', 'y/d.js']);
  assert.deepEqual(r, []);
});

test('returns the failed URI when it appears twice in the list', () => {
  const r = failedMembers('a/b.js', ['a/b.js', 'a/b.js']);
  assert.deepEqual(r, ["a/b.js"]);
});

test('returns the single match when the failed URI is a suffix of one entry only', () => {
  const r = failedMembers('b.js', ['a/b.js', 'c/c.js']);
  assert.deepEqual(r, ["a/b.js"]);
});

test('returns an empty array when the failed URI is a suffix of two entries', () => {
  const r = failedMembers('b.js', ['a/b.js', 'x/b.js']);
  assert.deepEqual(r, []);
});

test('returns the failed URI when it is the only entry in the list', () => {
  const r = failedMembers('solo.js', ['solo.js']);
  assert.deepEqual(r, ["solo.js"]);
});
