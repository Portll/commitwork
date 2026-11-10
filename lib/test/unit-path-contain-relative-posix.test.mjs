// Converts a path relative to a root into a POSIX-style path, or null if outside (lib/path-contain.mjs relativePosix).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativePosix } from '../path-contain.mjs';

test('returns null when the path is outside the root', () => {
  const r = relativePosix('/root', '/other/file.txt');
  assert.equal(r, null);
});

test('returns null when the path is the root itself', () => {
  const r = relativePosix('/root', '/root');
  assert.equal(r, "");
});

test('returns the posix relative path for a nested file', () => {
  const r = relativePosix('/root', '/root/src/index.js');
  assert.equal(r, "src/index.js");
});

test('returns null when the path escapes the root via parent directory', () => {
  const r = relativePosix('/root', '/root/../sibling');
  assert.equal(r, null);
});

test('returns null when the path is on a different drive on Windows', () => {
  const r = relativePosix('C:\\root', 'D:\\file.txt');
  assert.equal(r, null);
});

test('returns null when the path is the root with a trailing slash', () => {
  const r = relativePosix('/root', '/root/');
  assert.equal(r, "");
});

test('returns the posix relative path for a deep nested file', () => {
  const r = relativePosix('/root', '/root/a/b/c/d.txt');
  assert.equal(r, "a/b/c/d.txt");
});

test('returns null when the path is a sibling of the root', () => {
  const r = relativePosix('/root', '/sibling');
  assert.equal(r, null);
});
