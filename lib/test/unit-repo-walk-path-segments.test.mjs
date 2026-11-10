// Splits a path into its non-empty segments on forward or back slashes (lib/repo-walk.mjs pathSegments).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathSegments } from '../repo-walk.mjs';

test('returns empty array for empty string', () => {
  assert.deepEqual(pathSegments(''), []);
});

test('returns empty array for null', () => {
  assert.deepEqual(pathSegments(null), []);
});

test('returns empty array for undefined', () => {
  assert.deepEqual(pathSegments(undefined), []);
});

test('splits a single forward-slash path into segments', () => {
  assert.deepEqual(pathSegments('a/b/c'), ["a", "b", "c"]);
});

test('splits a single backslash path into segments', () => {
  assert.deepEqual(pathSegments('a\\b\\c'), ["a", "b", "c"]);
});

test('collapses consecutive separators into one split', () => {
  assert.deepEqual(pathSegments('a//b\\\\c'), ["a", "b", "c"]);
});

test('drops leading and trailing separators', () => {
  assert.deepEqual(pathSegments('/a/b/'), ["a", "b"]);
});

test('returns single segment for a path with no separators', () => {
  assert.deepEqual(pathSegments('node_modules'), ["node_modules"]);
});

test('splits a mixed-separator path', () => {
  assert.deepEqual(pathSegments('a/b\\c/d'), ["a", "b", "c", "d"]);
});

test('returns empty array for a string of only separators', () => {
  assert.deepEqual(pathSegments('///\\\\'), []);
});
