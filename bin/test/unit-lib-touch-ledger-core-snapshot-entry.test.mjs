// Snapshot of a regular file's rounded mtime and size, or null (bin/lib/touch-ledger-core.mjs snapshotEntry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotEntry } from '../lib/touch-ledger-core.mjs';

test('returns null when the stat argument is null', () => {
  const r = snapshotEntry(null);
  assert.equal(r, null);
});

test('returns null when the stat argument is undefined', () => {
  const r = snapshotEntry(undefined);
  assert.equal(r, null);
});

test('throws a TypeError when the stat argument is an object without isFile', () => {
  assert.throws(() => snapshotEntry({}), { name: 'TypeError', message: 'st.isFile is not a function' });
});

test('returns null when isFile is false and mtimeMs and size are present', () => {
  const st = { isFile: () => false, mtimeMs: 100.4, size: 50 };
  const r = snapshotEntry(st);
  assert.equal(r, null);
});

test('returns an entry with rounded mtime and size when isFile is true', () => {
  const st = { isFile: () => true, mtimeMs: 100.4, size: 50 };
  const r = snapshotEntry(st);
  assert.deepEqual(r, { m: 100, z: 50 });
});

test('returns an entry with the same mtime when mtimeMs is an integer', () => {
  const st = { isFile: () => true, mtimeMs: 200, size: 10 };
  const r = snapshotEntry(st);
  assert.deepEqual(r, { m: 200, z: 10 });
});

test('rounds mtimeMs up when its fraction is above one half', () => {
  const st = { isFile: () => true, mtimeMs: 100.6, size: 5 };
  const r = snapshotEntry(st);
  assert.deepEqual(r, { m: 101, z: 5 });
});

test('rounds mtimeMs up when its fraction is exactly one half', () => {
  const st = { isFile: () => true, mtimeMs: 100.5, size: 5 };
  const r = snapshotEntry(st);
  assert.deepEqual(r, { m: 101, z: 5 });
});

test('rounds mtimeMs down when its fraction is below one half', () => {
  const st = { isFile: () => true, mtimeMs: 100.4, size: 5 };
  const r = snapshotEntry(st);
  assert.deepEqual(r, { m: 100, z: 5 });
});
