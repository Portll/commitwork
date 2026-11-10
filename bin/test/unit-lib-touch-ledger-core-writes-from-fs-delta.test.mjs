// Sorted created, modified and deleted entries between two file snapshots (bin/lib/touch-ledger-core.mjs writesFromFsDelta).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writesFromFsDelta } from '../lib/touch-ledger-core.mjs';

test('returns an empty array when both snapshots are empty', () => {
  const r = writesFromFsDelta({}, {});
  assert.deepEqual(r, []);
});

test('marks a file as created when it appears in after but not before', () => {
  const r = writesFromFsDelta({}, { 'a.txt': { m: 1, z: 100 } });
  assert.deepEqual(r, [{ rel: 'a.txt', kind: 'created', corroborated: false }]);
});

test('marks a file as deleted when it exists in before but not after', () => {
  const r = writesFromFsDelta({ 'a.txt': { m: 1, z: 100 } }, {});
  assert.deepEqual(r, [{ rel: 'a.txt', kind: 'deleted', corroborated: false }]);
});

test('skips a file whose m and z are unchanged between snapshots', () => {
  const r = writesFromFsDelta({ 'a.txt': { m: 5, z: 50 } }, { 'a.txt': { m: 5, z: 50 } });
  assert.deepEqual(r, []);
});

test('marks a file as modified when m changes but z stays the same', () => {
  const r = writesFromFsDelta({ 'a.txt': { m: 5, z: 50 } }, { 'a.txt': { m: 6, z: 50 } });
  assert.deepEqual(r, [{ rel: 'a.txt', kind: 'modified', corroborated: false }]);
});

test('marks a file as modified when z changes but m stays the same', () => {
  const r = writesFromFsDelta({ 'a.txt': { m: 5, z: 50 } }, { 'a.txt': { m: 5, z: 51 } });
  assert.deepEqual(r, [{ rel: 'a.txt', kind: 'modified', corroborated: false }]);
});

test('sets corroborated only for created and deleted paths listed in parserNamed', () => {
  const before = { 'd.txt': { m: 1, z: 1 } };
  const after = { 'a.txt': { m: 1, z: 1 }, 'b.txt': { m: 1, z: 1 } };
  const r = writesFromFsDelta(before, after, { parserNamed: ['a.txt', 'd.txt', 'x.txt'] });
  assert.deepEqual(r, [
    { rel: 'a.txt', kind: 'created', corroborated: true },
    { rel: 'b.txt', kind: 'created', corroborated: false },
    { rel: 'd.txt', kind: 'deleted', corroborated: true },
  ]);
});

test('sorts results by rel path in ascending order', () => {
  const r = writesFromFsDelta({}, { 'c.txt': { m: 1, z: 1 }, 'a.txt': { m: 2, z: 2 }, 'b.txt': { m: 3, z: 3 } });
  assert.deepEqual(r, [
    { rel: 'a.txt', kind: 'created', corroborated: false },
    { rel: 'b.txt', kind: 'created', corroborated: false },
    { rel: 'c.txt', kind: 'created', corroborated: false },
  ]);
});

test('handles a mix of created, modified and deleted files with correct kinds and order', () => {
  const before = { 'z.txt': { m: 1, z: 10 }, 'm.txt': { m: 2, z: 20 } };
  const after = { 'm.txt': { m: 3, z: 20 }, 'a.txt': { m: 4, z: 40 } };
  const r = writesFromFsDelta(before, after);
  assert.deepEqual(r, [
    { rel: 'a.txt', kind: 'created', corroborated: false },
    { rel: 'm.txt', kind: 'modified', corroborated: false },
    { rel: 'z.txt', kind: 'deleted', corroborated: false },
  ]);
});

test('keeps a modified entry ahead of a deleted entry with the same rel when after hides keys from the in operator', () => {
  const before = { 'a.txt': { m: 1, z: 1 } };
  const after = new Proxy({ 'a.txt': { m: 2, z: 2 } }, { has: () => false });
  const r = writesFromFsDelta(before, after);
  assert.deepEqual(r, [
    { rel: 'a.txt', kind: 'modified', corroborated: false },
    { rel: 'a.txt', kind: 'deleted', corroborated: false },
  ]);
});
