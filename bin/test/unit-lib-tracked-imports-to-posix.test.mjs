// Converts a path string to POSIX separators (bin/lib/tracked-imports.mjs toPosix).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPosix } from '../lib/tracked-imports.mjs';

test('converts a single backslash to a forward slash', () => {
  const r = toPosix('a\\b');
  assert.equal(r, "a/b");
});

test('converts multiple backslashes to forward slashes', () => {
  const r = toPosix('a\\b\\c');
  assert.equal(r, "a/b/c");
});

test('returns a path with no backslashes unchanged', () => {
  const r = toPosix('a/b/c');
  assert.equal(r, "a/b/c");
});

test('returns an empty string for empty input', () => {
  const r = toPosix('');
  assert.equal(r, "");
});

test('converts a Windows-style path with drive letter', () => {
  const r = toPosix('C:\\Users\\test');
  assert.equal(r, "C:/Users/test");
});

test('converts a path with only forward slashes unchanged', () => {
  const r = toPosix('/usr/local/bin');
  assert.equal(r, "/usr/local/bin");
});

test('converts a path with mixed separators', () => {
  const r = toPosix('a\\b/c\\d');
  assert.equal(r, "a/b/c/d");
});

test('converts a long path with many backslashes', () => {
  const r = toPosix('a\\' + 'b'.repeat(10) + '\\c');
  assert.equal(r, "a/bbbbbbbbbb/c");
});
