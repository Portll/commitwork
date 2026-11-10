// Classifies a dependency spec as a non-registry reason or null (bin/lib/npm-versions.mjs nonRegistryReason).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nonRegistryReason } from '../lib/npm-versions.mjs';

test('returns file protocol reason', () => {
  const r = nonRegistryReason('file:../local');
  assert.equal(r, "declared as file: \u2014 not a registry version");
});

test('returns git protocol reason', () => {
  const r = nonRegistryReason('git+ssh://git@github.com/user/repo.git');
  assert.equal(r, "declared as git+ssh: \u2014 not a registry version");
});

test('returns repository shorthand reason', () => {
  const r = nonRegistryReason('user/repo');
  assert.equal(r, "declared as a repository shorthand \u2014 not a registry version");
});

test('returns dist-tag reason for latest', () => {
  const r = nonRegistryReason('latest');
  assert.equal(r, "declared as the dist-tag \"latest\", which npm follows itself");
});

test('returns dist-tag reason for beta', () => {
  const r = nonRegistryReason('beta');
  assert.equal(r, "declared as the dist-tag \"beta\", which npm follows itself");
});

test('returns null for version number', () => {
  const r = nonRegistryReason('1.2.3');
  assert.equal(r, null);
});

test('returns null for caret version', () => {
  const r = nonRegistryReason('^1.2.3');
  assert.equal(r, null);
});

test('returns null for tilde version', () => {
  const r = nonRegistryReason('~1.2.3');
  assert.equal(r, null);
});

test('returns null for empty string', () => {
  const r = nonRegistryReason('');
  assert.equal(r, null);
});

test('returns null for null input', () => {
  const r = nonRegistryReason(null);
  assert.equal(r, null);
});
