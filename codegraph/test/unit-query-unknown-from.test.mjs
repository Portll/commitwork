// Maps unreadable file entries to path and reason pairs (codegraph/query.mjs unknownFrom).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unknownFrom } from '../query.mjs';

test('returns empty array when files.unreadable is undefined', () => {
  const r = unknownFrom({ files: {} });
  assert.deepEqual(r, []);
});

test('returns empty array when files.unreadable is null', () => {
  const r = unknownFrom({ files: { unreadable: null } });
  assert.deepEqual(r, []);
});

test('returns empty array when files.unreadable is an empty array', () => {
  const r = unknownFrom({ files: { unreadable: [] } });
  assert.deepEqual(r, []);
});

test('maps a single unreadable entry to path and reason', () => {
  const r = unknownFrom({ files: { unreadable: [{ path: 'a.txt', reason: 'permission' }] } });
  assert.deepEqual(r, [{ path: "a.txt", reason: "permission" }]);
});

test('maps multiple unreadable entries preserving order', () => {
  const entries = Array.from({ length: 3 }, (_, i) => ({ path: `f${i}.js`, reason: `err${i}` }));
  const r = unknownFrom({ files: { unreadable: entries } });
  assert.deepEqual(r, [{ path: "f0.js", reason: "err0" }, { path: "f1.js", reason: "err1" }, { path: "f2.js", reason: "err2" }]);
});

test('returns empty array when files.unreadable is an empty string', () => {
  const r = unknownFrom({ files: { unreadable: '' } });
  assert.deepEqual(r, []);
});

test('maps entries with extra properties to only path and reason', () => {
  const r = unknownFrom({ files: { unreadable: [{ path: 'x', reason: 'y', extra: 'z' }] } });
  assert.deepEqual(r, [{ path: "x", reason: "y" }]);
});

test('handles unreadable entries with empty string path and reason', () => {
  const r = unknownFrom({ files: { unreadable: [{ path: '', reason: '' }] } });
  assert.deepEqual(r, [{ path: "", reason: "" }]);
});
