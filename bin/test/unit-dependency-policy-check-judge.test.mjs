// Decides whether each dependency update is allowed by the automerge policy (bin/dependency-policy-check.mjs judge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../dependency-policy-check.mjs';

test('allows a semver patch update for a direct production npm dependency when prod allows patch', () => {
  const policy = { automerge: { prod: ['patch'] } };
  const updates = [{ dependencyName: 'left-pad', packageEcosystem: 'npm', dependencyType: 'direct:production', updateType: 'version-update:semver-patch' }];
  assert.deepEqual(judge(policy, updates), [{ name: "left-pad", allowed: true, why: "prod patch" }]);
});

test('denies a semver patch update for a direct production npm dependency when prod does not allow patch', () => {
  const policy = { automerge: { prod: ['minor'] } };
  const updates = [{ dependencyName: 'left-pad', packageEcosystem: 'npm', dependencyType: 'direct:production', updateType: 'version-update:semver-patch' }];
  assert.deepEqual(judge(policy, updates), [{ name: "left-pad", allowed: false, why: "prod patch is not in automerge" }]);
});

test('allows a semver minor update for a direct development npm dependency when dev allows minor', () => {
  const policy = { automerge: { dev: ['minor'] } };
  const updates = [{ dependencyName: 'eslint', packageEcosystem: 'npm', dependencyType: 'direct:development', updateType: 'version-update:semver-minor' }];
  assert.deepEqual(judge(policy, updates), [{ name: "eslint", allowed: true, why: "dev minor" }]);
});

test('denies a semver major update for an indirect npm dependency when prod and dev do not allow lockfile', () => {
  const policy = { automerge: { prod: ['patch'], dev: ['minor'] } };
  const updates = [{ dependencyName: 'some-transitive', packageEcosystem: 'npm', dependencyType: 'indirect', updateType: 'version-update:semver-major' }];
  assert.deepEqual(judge(policy, updates), [{ name: "some-transitive", allowed: false, why: "prod+dev lockfile is not in automerge" }]);
});

test('allows a semver major update for an indirect npm dependency when prod and dev allow lockfile', () => {
  const policy = { automerge: { prod: ['lockfile'], dev: ['lockfile'] } };
  const updates = [{ dependencyName: 'some-transitive', packageEcosystem: 'npm', dependencyType: 'indirect', updateType: 'version-update:semver-major' }];
  assert.deepEqual(judge(policy, updates), [{ name: "some-transitive", allowed: true, why: "prod+dev lockfile" }]);
});

test('denies a semver patch update for a github actions dependency when actions does not allow patch', () => {
  const policy = { automerge: { actions: ['minor'] } };
  const updates = [{ dependencyName: 'actions/checkout', packageEcosystem: 'github_actions', updateType: 'version-update:semver-patch' }];
  assert.deepEqual(judge(policy, updates), [{ name: "actions/checkout", allowed: false, why: "actions patch is not in automerge.actions" }]);
});

test('allows a semver minor update for a github actions dependency when actions allows minor', () => {
  const policy = { automerge: { actions: ['minor'] } };
  const updates = [{ dependencyName: 'actions/checkout', packageEcosystem: 'github-actions', updateType: 'version-update:semver-minor' }];
  assert.deepEqual(judge(policy, updates), [{ name: "actions/checkout", allowed: true, why: "actions minor" }]);
});

test('denies a semver patch update for a rubygems dependency because that ecosystem has no policy', () => {
  const policy = { automerge: { prod: ['patch'] } };
  const updates = [{ dependencyName: 'rails', packageEcosystem: 'rubygems', dependencyType: 'direct:production', updateType: 'version-update:semver-patch' }];
  assert.deepEqual(judge(policy, updates), [{ name: "rails", allowed: false, why: "ecosystem rubygems has no policy here" }]);
});

test('allows a semver patch update for a direct production npm dependency via the advisories fallback when ghsa is set and prod allows advisories', () => {
  const policy = { automerge: { prod: ['advisories'] } };
  const updates = [{ dependencyName: 'lodash', packageEcosystem: 'npm', dependencyType: 'direct:production', updateType: 'version-update:semver-patch' }];
  assert.deepEqual(judge(policy, updates, { ghsa: 'GHSA-1234-5678-9012' }), [{ name: "lodash", allowed: true, why: "prod advisories (security update GHSA-1234-5678-9012)" }]);
});

test('denies a semver patch update for a direct production npm dependency when ghsa is empty and prod does not allow patch', () => {
  const policy = { automerge: { prod: ['advisories'] } };
  const updates = [{ dependencyName: 'lodash', packageEcosystem: 'npm', dependencyType: 'direct:production', updateType: 'version-update:semver-patch' }];
  assert.deepEqual(judge(policy, updates, { ghsa: '' }), [{ name: "lodash", allowed: false, why: "prod patch is not in automerge" }]);
});
