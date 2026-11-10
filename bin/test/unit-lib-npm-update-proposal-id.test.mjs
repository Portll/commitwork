// Computes a 12-char hex proposal identifier from update inputs (bin/lib/npm-update.mjs proposalId).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposalId } from '../lib/npm-update.mjs';

test('returns a 12-character hex string for a minimal update proposal', () => {
  const r = proposalId({ base: 'v1.0.0', pkgPath: 'package.json', direct: [{ name: 'lodash', version: '4.17.21' }], lockfile: true, advisories: false });
  assert.equal(r, "35c5124caec2");
});

test('produces a different id when the base version changes', () => {
  const r = proposalId({ base: 'v2.0.0', pkgPath: 'package.json', direct: [{ name: 'lodash', version: '4.17.21' }], lockfile: true, advisories: false });
  assert.equal(r, "c21e212ea2e4");
});

test('produces a different id when the package path changes', () => {
  const r = proposalId({ base: 'v1.0.0', pkgPath: 'packages/app/package.json', direct: [{ name: 'lodash', version: '4.17.21' }], lockfile: true, advisories: false });
  assert.equal(r, "8c474a25f564");
});

test('sorts direct dependencies before hashing so order does not matter', () => {
  const r = proposalId({ base: 'v1.0.0', pkgPath: 'package.json', direct: [{ name: 'zeta', version: '1.0.0' }, { name: 'alpha', version: '2.0.0' }], lockfile: false, advisories: true });
  assert.equal(r, "8848f3e3d664");
});

test('treats lockfile and advisories as booleans in the hash input', () => {
  const r = proposalId({ base: 'v1.0.0', pkgPath: 'package.json', direct: [], lockfile: 1, advisories: 0 });
  assert.equal(r, "913f3de30c0e");
});

test('produces a different id when advisories is truthy instead of falsy', () => {
  const r = proposalId({ base: 'v1.0.0', pkgPath: 'package.json', direct: [{ name: 'express', version: '4.18.2' }], lockfile: false, advisories: true });
  assert.equal(r, "111fc2da7d59");
});

test('handles an empty direct dependency list', () => {
  const r = proposalId({ base: 'v0.1.0', pkgPath: 'package.json', direct: [], lockfile: false, advisories: false });
  assert.equal(r, "bf340afc12ff");
});

test('handles multiple direct dependencies with repeated names', () => {
  const r = proposalId({ base: 'v1.0.0', pkgPath: 'package.json', direct: [{ name: 'react', version: '18.2.0' }, { name: 'react', version: '18.3.0' }], lockfile: true, advisories: true });
  assert.equal(r, "3c8a95bc091d");
});
