// Free space on the filesystem containing a path, via statfs (lib/durable-write.mjs freeSpace).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeSpace } from '../durable-write.mjs';

test('returns ok with freeBytes when statfsSync succeeds with valid values', () => {
  const io = { statfsSync: () => ({ bsize: 4096, bavail: 100 }) };
  const r = freeSpace('/some/dir/file.txt', { io });
  assert.deepEqual(r, { state: "ok", freeBytes: 409600, blockSize: 4096, why: null });
});

test('returns unknown when statfsSync is not a function', () => {
  const io = { statfsSync: undefined };
  const r = freeSpace('/some/dir/file.txt', { io });
  assert.deepEqual(r, { state: "unknown", freeBytes: null, why: "fs.statfsSync is not available on this runtime \u2014 free space is undetermined, which is neither ample nor exhausted" });
});

test('returns unknown when statfsSync throws an error', () => {
  const io = { statfsSync: () => { throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }); } };
  const r = freeSpace('/some/dir/file.txt', { io });
  assert.deepEqual(r, { state: "unknown", freeBytes: null, errno: "ENOSPC", why: "statfs(/some/dir) failed: no space left on device \u2014 undetermined, not empty" });
});

test('returns unknown when blockSize is zero', () => {
  const io = { statfsSync: () => ({ bsize: 0, bavail: 100 }) };
  const r = freeSpace('/some/dir/file.txt', { io });
  assert.deepEqual(r, { state: "unknown", freeBytes: null, why: "statfs returned no usable block size or available count \u2014 undetermined" });
});

test('returns ok when blockSize is one', () => {
  const io = { statfsSync: () => ({ bsize: 1, bavail: 50 }) };
  const r = freeSpace('/some/dir/file.txt', { io });
  assert.deepEqual(r, { state: "ok", freeBytes: 50, blockSize: 1, why: null });
});

test('returns unknown when avail is not finite', () => {
  const io = { statfsSync: () => ({ bsize: 4096, bavail: NaN }) };
  const r = freeSpace('/some/dir/file.txt', { io });
  assert.deepEqual(r, { state: "unknown", freeBytes: null, why: "statfs returned no usable block size or available count \u2014 undetermined" });
});

test('returns unknown when statfsSync returns null', () => {
  const io = { statfsSync: () => null };
  const r = freeSpace('/some/dir/file.txt', { io });
  assert.deepEqual(r, { state: "unknown", freeBytes: null, why: "statfs returned no usable block size or available count \u2014 undetermined" });
});

test('returns unknown when statfsSync returns an object with no bsize or frsize', () => {
  const io = { statfsSync: () => ({ bavail: 100 }) };
  const r = freeSpace('/some/dir/file.txt', { io });
  assert.deepEqual(r, { state: "unknown", freeBytes: null, why: "statfs returned no usable block size or available count \u2014 undetermined" });
});
