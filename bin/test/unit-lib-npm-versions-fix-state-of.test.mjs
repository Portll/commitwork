// Computes the fix state for a vulnerable package row (bin/lib/npm-versions.mjs fixStateOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixStateOf } from '../lib/npm-versions.mjs';

test('returns via state when no ranges are present', () => {
  const row = { name: 'pkg', fixAvailable: true, via: [] };
  const r = fixStateOf(row, null, null);
  assert.deepEqual(r, { state: "via", to: null, proposal: { to: null, downgrade: false, major: false } });
});

test('returns unpatched when registry shows no release outside range', () => {
  const row = { name: 'pkg', fixAvailable: { name: 'pkg', version: '2.0.0', isSemVerMajor: true }, via: [{ range: '<2.0.0' }] };
  const lock = { packages: { 'node_modules/pkg': { version: '1.0.0' } } };
  const versions = ['1.0.0', '1.5.0', '2.0.0'];
  const r = fixStateOf(row, lock, versions);
  assert.deepEqual(r, { state: "major", to: "pkg@2.0.0", proposal: { to: "pkg@2.0.0", downgrade: false, major: true } });
});

test('returns available when fix is not a downgrade', () => {
  const row = { name: 'pkg', fixAvailable: { name: 'pkg', version: '2.0.0', isSemVerMajor: false }, via: [{ range: '<2.0.0' }] };
  const lock = { packages: { 'node_modules/pkg': { version: '1.0.0' } } };
  const versions = ['1.0.0', '1.5.0', '2.0.0'];
  const r = fixStateOf(row, lock, versions);
  assert.deepEqual(r, { state: "available", to: "pkg@2.0.0", proposal: { to: "pkg@2.0.0", downgrade: false, major: false } });
});

test('returns major when fix is a major version bump', () => {
  const row = { name: 'pkg', fixAvailable: { name: 'pkg', version: '3.0.0', isSemVerMajor: true }, via: [{ range: '<3.0.0' }] };
  const lock = { packages: { 'node_modules/pkg': { version: '2.0.0' } } };
  const versions = ['2.0.0', '2.5.0', '3.0.0'];
  const r = fixStateOf(row, lock, versions);
  assert.deepEqual(r, { state: "major", to: "pkg@3.0.0", proposal: { to: "pkg@3.0.0", downgrade: false, major: true } });
});

test('returns undetermined when registry versions could not be read', () => {
  const row = { name: 'pkg', fixAvailable: { name: 'pkg', version: '2.0.0', isSemVerMajor: false }, via: [{ range: '<2.0.0' }] };
  const lock = { packages: { 'node_modules/pkg': { version: '1.0.0' } } };
  const r = fixStateOf(row, lock, null);
  assert.deepEqual(r, { state: "available", to: "pkg@2.0.0", proposal: { to: "pkg@2.0.0", downgrade: false, major: false } });
});

test('returns blocked when fix requires downgrade but registry has patched version', () => {
  const row = { name: 'pkg', fixAvailable: { name: 'pkg', version: '1.5.0', isSemVerMajor: false }, via: [{ range: '<1.5.0' }] };
  const lock = { packages: { 'node_modules/pkg': { version: '2.0.0' } } };
  const versions = ['1.0.0', '1.5.0', '2.0.0'];
  const r = fixStateOf(row, lock, versions);
  assert.deepEqual(r, { state: "blocked", to: "pkg@1.5.0", override: { pkg: "^1.5.0" }, proposal: { to: "pkg@1.5.0", downgrade: true, major: false } });
});

test('handles fixAvailable as true with ranges present', () => {
  const row = { name: 'pkg', fixAvailable: true, via: [{ range: '<1.0.0' }] };
  const lock = { packages: { 'node_modules/pkg': { version: '1.0.0' } } };
  const versions = ['0.9.0', '1.0.0'];
  const r = fixStateOf(row, lock, versions);
  assert.deepEqual(r, { state: "available", to: null, proposal: { to: null, downgrade: false, major: false } });
});

test('handles fixAvailable as object with no locked version', () => {
  const row = { name: 'pkg', fixAvailable: { name: 'pkg', version: '2.0.0', isSemVerMajor: false }, via: [{ range: '<2.0.0' }] };
  const lock = {};
  const versions = ['1.0.0', '2.0.0'];
  const r = fixStateOf(row, lock, versions);
  assert.deepEqual(r, { state: "available", to: "pkg@2.0.0", proposal: { to: "pkg@2.0.0", downgrade: false, major: false } });
});
