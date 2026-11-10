// Validates that a value is a list of known update kinds with no duplicates (bin/lib/update-policy.mjs validateKinds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateKinds } from '../lib/update-policy.mjs';

test('returns an error message when the value is not an array', () => {
  const r = validateKinds('patch', 'policy');
  assert.equal(r, "policy must be a list of update kinds");
});

test('returns an error message when the value is null', () => {
  const r = validateKinds(null, 'policy');
  assert.equal(r, "policy must be a list of update kinds");
});

test('returns null when the value is an empty array', () => {
  const r = validateKinds([], 'policy');
  assert.equal(r, null);
});

test('returns null when the value is a single valid kind', () => {
  const r = validateKinds(['patch'], 'policy');
  assert.equal(r, null);
});

test('returns null when the value is multiple valid kinds', () => {
  const r = validateKinds(['patch', 'minor'], 'policy');
  assert.equal(r, null);
});

test('returns an error message when the value contains an unknown kind', () => {
  const r = validateKinds(['patch', 'bogus'], 'policy');
  assert.equal(r, "policy: unknown update kind(s) bogus \u2014 known: patch, minor, major, lockfile, advisories");
});

test('returns an error message when the value contains multiple unknown kinds', () => {
  const r = validateKinds(['bogus1', 'bogus2'], 'policy');
  assert.equal(r, "policy: unknown update kind(s) bogus1, bogus2 \u2014 known: patch, minor, major, lockfile, advisories");
});

test('returns an error message when a kind is listed more than once', () => {
  const r = validateKinds(['patch', 'patch'], 'policy');
  assert.equal(r, "policy: a kind is listed more than once");
});

test('returns an error message when a kind is listed three times', () => {
  const r = validateKinds(['minor', 'minor', 'minor'], 'policy');
  assert.equal(r, "policy: a kind is listed more than once");
});

test('returns null when the value is a long list of valid kinds with no duplicates', () => {
  const kinds = ['patch', 'minor', 'major', 'prerelease'];
  const r = validateKinds(kinds, 'policy');
  assert.equal(r, "policy: unknown update kind(s) prerelease \u2014 known: patch, minor, major, lockfile, advisories");
});
