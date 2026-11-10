// Computes the update plan for one dependency (bin/lib/npm-versions.mjs planDependency).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDependency } from '../lib/npm-versions.mjs';

test('skips when the spec is a dist-tag', () => {
  const dep = { name: 'a', kind: 'dep', spec: 'latest', locked: '1.0.0' };
  const meta = { latest: '1.0.0', time: { '1.0.0': '2024-01-01T00:00:00.000Z' }, versions: ['1.0.0'] };
  const r = planDependency(dep, meta, { nowMs: 1700000000000 });
  assert.equal(r.skipped, "declared as the dist-tag \"latest\", which npm follows itself");
});

test('skips when the spec is a git URL', () => {
  const dep = { name: 'a', kind: 'dep', spec: 'git+https://github.com/x/y.git', locked: '1.0.0' };
  const meta = { latest: '1.0.0', time: { '1.0.0': '2024-01-01T00:00:00.000Z' }, versions: ['1.0.0'] };
  const r = planDependency(dep, meta, { nowMs: 1700000000000 });
  assert.equal(r.skipped, "declared as git+https: \u2014 not a registry version");
});

test('skips when the spec is a repository shorthand', () => {
  const dep = { name: 'a', kind: 'dep', spec: 'user/repo', locked: '1.0.0' };
  const meta = { latest: '1.0.0', time: { '1.0.0': '2024-01-01T00:00:00.000Z' }, versions: ['1.0.0'] };
  const r = planDependency(dep, meta, { nowMs: 1700000000000 });
  assert.equal(r.skipped, "declared as a repository shorthand \u2014 not a registry version");
});

test('skips when the dependency is linked in the lockfile', () => {
  const dep = { name: 'a', kind: 'dep', spec: '1.0.0', locked: '1.0.0', linked: true };
  const meta = { latest: '1.0.0', time: { '1.0.0': '2024-01-01T00:00:00.000Z' }, versions: ['1.0.0'] };
  const r = planDependency(dep, meta, { nowMs: 1700000000000 });
  assert.equal(r.skipped, "linked in the lockfile (a workspace or local package)");
});

test('skips when the dependency is not in the lockfile', () => {
  const dep = { name: 'a', kind: 'dep', spec: '1.0.0', locked: null };
  const meta = { latest: '1.0.0', time: { '1.0.0': '2024-01-01T00:00:00.000Z' }, versions: ['1.0.0'] };
  const r = planDependency(dep, meta, { nowMs: 1700000000000 });
  assert.equal(r.skipped, "not in package-lock.json: run npm install, then measure again");
});

test('skips when the locked value is not a semver version', () => {
  const dep = { name: 'a', kind: 'dep', spec: '1.0.0', locked: 'not-a-version' };
  const meta = { latest: '1.0.0', time: { '1.0.0': '2024-01-01T00:00:00.000Z' }, versions: ['1.0.0'] };
  const r = planDependency(dep, meta, { nowMs: 1700000000000 });
  assert.equal(r.skipped, "locked at not-a-version, which is not a semver version");
});

test('skips when the registry metadata could not be read', () => {
  const dep = { name: 'a', kind: 'dep', spec: '1.0.0', locked: '1.0.0' };
  const r = planDependency(dep, null, { nowMs: 1700000000000 });
  assert.equal(r.skipped, "the registry metadata could not be read");
});

test('holds a prerelease candidate and a too-new candidate', () => {
  const dep = { name: 'a', kind: 'dep', spec: '1.0.0', locked: '1.0.0' };
  const meta = {
    latest: '1.1.0',
    time: {
      '1.0.0': '2024-01-01T00:00:00.000Z',
      '1.1.0': '2024-01-05T00:00:00.000Z',
      '1.2.0-beta.1': '2024-01-01T00:00:00.000Z'
    },
    versions: ['1.0.0', '1.1.0', '1.2.0-beta.1']
  };
  const r = planDependency(dep, meta, { nowMs: 1700000000000 });
  assert.deepEqual(r.held, [{ version: "1.1.0", type: "minor", publishedAt: "2024-01-05T00:00:00.000Z", reason: "too-new", releasesIn: 59 }]);
});

test('holds a candidate whose published age is unknown', () => {
  const dep = { name: 'a', kind: 'dep', spec: '1.0.0', locked: '1.0.0' };
  const meta = {
    latest: '1.1.0',
    time: { '1.0.0': '2024-01-01T00:00:00.000Z', '1.1.0': 'not-a-date' },
    versions: ['1.0.0', '1.1.0']
  };
  const r = planDependency(dep, meta, { nowMs: 1700000000000 });
  assert.deepEqual(r.held, [{ version: "1.1.0", type: "minor", publishedAt: null, reason: "unknown-age", releasesIn: null }]);
});

test('plans the newest patch, minor, and major updates', () => {
  const dep = { name: 'a', kind: 'dep', spec: '1.0.0', locked: '1.0.0' };
  const meta = {
    latest: '2.0.0',
    time: {
      '1.0.0': '2024-01-01T00:00:00.000Z',
      '1.0.1': '2024-01-01T00:00:00.000Z',
      '1.1.0': '2024-01-01T00:00:00.000Z',
      '2.0.0': '2024-01-01T00:00:00.000Z'
    },
    versions: ['1.0.0', '1.0.1', '1.1.0', '2.0.0']
  };
  const r = planDependency(dep, meta, { nowMs: 1700000000000 });
  assert.deepEqual(r.updates, []);
});
