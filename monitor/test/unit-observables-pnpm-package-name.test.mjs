// strips peer suffix and version from a pnpm key (monitor/observables.mjs pnpmPackageName).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pnpmPackageName } from '../observables.mjs';

test('returns the name before the version separator for a scoped package', () => {
  const r = pnpmPackageName('@scope/pkg@1.0.0');
  assert.equal(r, "@scope/pkg");
});

test('returns the name before the version separator for an unscoped package', () => {
  const r = pnpmPackageName('pkg@1.0.0');
  assert.equal(r, "pkg");
});

test('returns the whole key when the at sign is at index zero', () => {
  const r = pnpmPackageName('@scope/pkg');
  assert.equal(r, "@scope/pkg");
});

test('returns the whole key when there is no at sign', () => {
  const r = pnpmPackageName('pkg');
  assert.equal(r, "pkg");
});

test('returns the whole key when the at sign is at index one', () => {
  const r = pnpmPackageName('a@1.0.0');
  assert.equal(r, "a");
});

test('returns the whole key when the at sign is at index two', () => {
  const r = pnpmPackageName('ab@1.0.0');
  assert.equal(r, "ab");
});

test('strips a peer dependency suffix before extracting the name', () => {
  const r = pnpmPackageName('pkg@1.0.0(peer@1.0.0)');
  assert.equal(r, "pkg");
});

test('strips a peer dependency suffix from a scoped package', () => {
  const r = pnpmPackageName('@scope/pkg@1.0.0(peer@1.0.0)');
  assert.equal(r, "@scope/pkg");
});
