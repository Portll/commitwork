// Maps a user selection to validated direct updates and flags (bin/lib/npm-update.mjs resolveSelection).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSelection } from '../lib/npm-update.mjs';

test('returns empty direct when selection has no direct array', () => {
  const r = resolveSelection({}, { deps: [] });
  assert.deepEqual(r, { direct: [], lockfile: false, advisories: false });
});

test('returns error when a selected name is not in report deps', () => {
  const r = resolveSelection({ direct: [{ name: 'missing', version: '1.0.0' }] }, { deps: [] });
  assert.deepEqual(r, { error: "missing is not a measured direct dependency" });
});

test('returns error when the selected dependency is skipped', () => {
  const r = resolveSelection({ direct: [{ name: 'a', version: '1.0.0' }] }, { deps: [{ name: 'a', skipped: true }] });
  assert.deepEqual(r, { error: "a is not a measured direct dependency" });
});

test('returns error when the selected version is not in updates or held', () => {
  const r = resolveSelection({ direct: [{ name: 'a', version: '9.9.9' }] }, { deps: [{ name: 'a', updates: [{ version: '1.0.0' }], held: [] }] });
  assert.deepEqual(r, { error: "a@9.9.9 is not an update the audit found" });
});

test('returns error when the selected version is in held cooldown', () => {
  const r = resolveSelection({ direct: [{ name: 'a', version: '1.0.0' }] }, { deps: [{ name: 'a', updates: [], held: [{ version: '1.0.0' }] }] });
  assert.deepEqual(r, { error: "a@1.0.0 is inside its cooldown" });
});

test('returns validated direct entry when version is in updates', () => {
  const r = resolveSelection({ direct: [{ name: 'a', version: '2.0.0' }] }, { deps: [{ name: 'a', kind: 'dep', spec: '^1.0.0', locked: '1.0.0', updates: [{ version: '2.0.0', type: 'minor', publishedAt: '2024-01-01' }], held: [] }] });
  assert.deepEqual(r, { direct: [{ name: "a", kind: "dep", spec: "^1.0.0", from: "1.0.0", version: "2.0.0", type: "minor", publishedAt: "2024-01-01" }], lockfile: false, advisories: false });
});

test('returns error when selected version is in held but not in updates', () => {
  const r = resolveSelection({ direct: [{ name: 'a', version: '1.5.0' }] }, { deps: [{ name: 'a', updates: [{ version: '2.0.0' }], held: [{ version: '1.5.0' }] }] });
  assert.deepEqual(r, { error: "a@1.5.0 is inside its cooldown" });
});

test('returns error when selected version is in neither updates nor held', () => {
  const r = resolveSelection({ direct: [{ name: 'a', version: '3.0.0' }] }, { deps: [{ name: 'a', updates: [{ version: '2.0.0' }], held: [{ version: '1.5.0' }] }] });
  assert.deepEqual(r, { error: "a@3.0.0 is not an update the audit found" });
});
