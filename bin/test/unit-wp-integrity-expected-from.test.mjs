// Maps a source body to a map of path to expected md5 and sha256 sets (bin/wp-integrity.mjs expectedFrom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedFrom } from '../wp-integrity.mjs';

test('core kind with checksums object returns map with md5 set and empty sha256 set', () => {
  const r = expectedFrom('core', { checksums: { 'wp-load.php': ['abc123', 'def456'] } });
  assert.deepEqual(r, new Map([["wp-load.php", { md5: new Set(["abc123", "def456"]), sha256: new Set([]) }]]));
});

test('core kind with missing checksums returns empty map', () => {
  const r = expectedFrom('core', {});
  assert.deepEqual(r, new Map([]));
});

test('non-core kind with files object returns map with md5 and sha256 sets', () => {
  const r = expectedFrom('plugin', { files: { 'index.php': { md5: ['aaa'], sha256: ['bbb'] } } });
  assert.deepEqual(r, new Map([["index.php", { md5: new Set(["aaa"]), sha256: new Set(["bbb"]) }]]));
});

test('non-core kind with missing files returns empty map', () => {
  const r = expectedFrom('plugin', {});
  assert.deepEqual(r, new Map([]));
});

test('non-core kind skips file entries that are null', () => {
  const r = expectedFrom('plugin', { files: { 'a.php': null, 'b.php': { md5: ['x'], sha256: ['y'] } } });
  assert.deepEqual(r, new Map([["b.php", { md5: new Set(["x"]), sha256: new Set(["y"]) }]]));
});

test('non-core kind skips file entries that are strings', () => {
  const r = expectedFrom('plugin', { files: { 'a.php': 'not-an-object', 'b.php': { md5: ['x'], sha256: ['y'] } } });
  assert.deepEqual(r, new Map([["b.php", { md5: new Set(["x"]), sha256: new Set(["y"]) }]]));
});

test('non-core kind skips file entries that are numbers', () => {
  const r = expectedFrom('plugin', { files: { 'a.php': 42, 'b.php': { md5: ['x'], sha256: ['y'] } } });
  assert.deepEqual(r, new Map([["b.php", { md5: new Set(["x"]), sha256: new Set(["y"]) }]]));
});

test('non-core kind skips file entries that are booleans', () => {
  const r = expectedFrom('plugin', { files: { 'a.php': true, 'b.php': { md5: ['x'], sha256: ['y'] } } });
  assert.deepEqual(r, new Map([["b.php", { md5: new Set(["x"]), sha256: new Set(["y"]) }]]));
});

test('non-core kind includes file entries that are objects with missing md5 and sha256', () => {
  const r = expectedFrom('plugin', { files: { 'a.php': {} } });
  assert.deepEqual(r, new Map([["a.php", { md5: new Set([]), sha256: new Set([]) }]]));
});

test('core kind with checksums containing non-string values filters them out', () => {
  const r = expectedFrom('core', { checksums: { 'wp.php': ['valid', 123, null, 'UPPER'] } });
  assert.deepEqual(r, new Map([["wp.php", { md5: new Set(["valid", "upper"]), sha256: new Set([]) }]]));
});
