// Extracts file paths from commit message text (bin/lib/gate-message-core.mjs pathsNamed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathsNamed } from '../lib/gate-message-core.mjs';

test('returns empty array for empty string input', () => {
  const r = pathsNamed('');
  assert.deepEqual(r, []);
});

test('returns empty array for null input', () => {
  const r = pathsNamed(null);
  assert.deepEqual(r, []);
});

test('returns empty array for undefined input', () => {
  const r = pathsNamed(undefined);
  assert.deepEqual(r, []);
});

test('extracts a single valid path from text', () => {
  const r = pathsNamed('fix bug in src/lib/foo.js');
  assert.deepEqual(r, ["src/lib/foo.js"]);
});

test('extracts multiple distinct paths in order of appearance', () => {
  const r = pathsNamed('update src/a.js and src/b.js and src/c.js');
  assert.deepEqual(r, ["src/a.js", "src/b.js", "src/c.js"]);
});

test('deduplicates repeated paths', () => {
  const r = pathsNamed('src/a.js src/a.js src/b.js');
  assert.deepEqual(r, ["src/a.js", "src/b.js"]);
});

test('stops collecting after reaching default max of 12', () => {
  const paths = Array.from({ length: 15 }, (_, i) => `src/file${i}.js`);
  const r = pathsNamed(paths.join(' '));
  assert.deepEqual(r, ["src/file0.js", "src/file1.js", "src/file2.js", "src/file3.js", "src/file4.js", "src/file5.js", "src/file6.js", "src/file7.js", "src/file8.js", "src/file9.js", "src/file10.js", "src/file11.js"]);
});

test('respects custom max option', () => {
  const r = pathsNamed('src/a.js src/b.js src/c.js src/d.js', { max: 2 });
  assert.deepEqual(r, ["src/a.js", "src/b.js"]);
});

test('handles path with multiple directory segments', () => {
  const r = pathsNamed('edit src/lib/util/helper.mjs');
  assert.deepEqual(r, ["src/lib/util/helper.mjs"]);
});

test('ignores paths with unsupported extensions', () => {
  const r = pathsNamed('see src/foo.py and src/bar.txt');
  assert.deepEqual(r, []);
});
