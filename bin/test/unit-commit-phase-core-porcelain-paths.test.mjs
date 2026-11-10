// Unique file paths named in NUL-separated git status porcelain output (bin/commit-phase-core.mjs porcelainPaths).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { porcelainPaths } from '../commit-phase-core.mjs';

test('null input yields an empty list', () => {
  assert.deepEqual(porcelainPaths(null), []);
});

test('empty string yields an empty list', () => {
  assert.deepEqual(porcelainPaths(''), []);
});

test('entries of length four are kept and entries of length three are skipped', () => {
  assert.deepEqual(porcelainPaths(' M a\0 M \0 M bc'), ['a', 'bc']);
});

test('a rename entry is followed by its source path', () => {
  assert.deepEqual(porcelainPaths('R  new\0old\0 M x\0'), ['new', 'old', 'x']);
});

test('a rename at the very end still picks up its source path', () => {
  assert.deepEqual(porcelainPaths('R  new\0old'), ['new', 'old']);
});

test('a rename with an empty following entry adds no source path', () => {
  assert.deepEqual(porcelainPaths('R  new\0'), ['new']);
});

test('an R in the third status column does not mark a rename', () => {
  assert.deepEqual(porcelainPaths('MMRab\0 M yz'), ['ab', 'yz']);
});

test('a copy in the worktree column is followed by its source path', () => {
  assert.deepEqual(porcelainPaths(' C dst\0src'), ['dst', 'src']);
});

test('duplicate paths are listed once', () => {
  assert.deepEqual(porcelainPaths(' M a\0 M a\0'), ['a']);
});

test('non-string input is converted to a string first', () => {
  assert.deepEqual(porcelainPaths(12345), ['45']);
});
