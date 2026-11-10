// Collects sorted unique kinds from roots, files, profiles, and commands (monitor/persistence-diff.mjs surfaceKinds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { surfaceKinds } from '../persistence-diff.mjs';

test('returns empty array when input is empty object', () => {
  const r = surfaceKinds({});
  assert.deepEqual(r, []);
});

test('returns sorted kinds from roots only', () => {
  const r = surfaceKinds({ roots: [{ kind: 'b' }, { kind: 'a' }] });
  assert.deepEqual(r, ["a", "b"]);
});

test('returns sorted kinds from files only', () => {
  const r = surfaceKinds({ files: [{ kind: 'z' }, { kind: 'y' }] });
  assert.deepEqual(r, ["y", "z"]);
});

test('returns shell-profile when profiles array is non-empty', () => {
  const r = surfaceKinds({ profiles: [{ name: 'p' }] });
  assert.deepEqual(r, ["shell-profile"]);
});

test('returns sorted kinds from commands only', () => {
  const r = surfaceKinds({ commands: [{ kind: 'c' }, { kind: 'd' }] });
  assert.deepEqual(r, ["c", "d"]);
});

test('returns sorted unique kinds from all sources', () => {
  const r = surfaceKinds({
    roots: [{ kind: 'root' }],
    files: [{ kind: 'file' }],
    profiles: [{ name: 'x' }],
    commands: [{ kind: 'cmd' }]
  });
  assert.deepEqual(r, ["cmd", "file", "root", "shell-profile"]);
});

test('returns empty array when profiles array is empty', () => {
  const r = surfaceKinds({ profiles: [] });
  assert.deepEqual(r, []);
});

test('returns sorted kinds with duplicates removed', () => {
  const r = surfaceKinds({
    roots: [{ kind: 'a' }],
    files: [{ kind: 'a' }, { kind: 'b' }]
  });
  assert.deepEqual(r, ["a", "b"]);
});
