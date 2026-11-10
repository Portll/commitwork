// Compares two semver strings and returns -1, 0, or 1 (bin/commit-phase-core.mjs compareSemver).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSemver } from '../commit-phase-core.mjs';

test('returns null when the first argument is not a valid semver string', () => {
  assert.equal(compareSemver('not-a-version', '1.0.0'), null);
});

test('returns null when the second argument is not a valid semver string', () => {
  assert.equal(compareSemver('1.0.0', 'not-a-version'), null);
});

test('returns -1 when the major version of the first is less than the second', () => {
  assert.equal(compareSemver('1.0.0', '2.0.0'), -1);
});

test('returns 1 when the major version of the first is greater than the second', () => {
  assert.equal(compareSemver('2.0.0', '1.0.0'), 1);
});

test('returns 1 when the first has no prerelease and the second has one', () => {
  assert.equal(compareSemver('1.0.0', '1.0.0-alpha'), 1);
});

test('returns -1 when the first has a prerelease and the second has none', () => {
  assert.equal(compareSemver('1.0.0-alpha', '1.0.0'), -1);
});

test('returns 0 when both versions are identical with no prerelease', () => {
  assert.equal(compareSemver('1.2.3', '1.2.3'), 0);
});

test('returns -1 when the first prerelease has fewer identifiers than the second', () => {
  assert.equal(compareSemver('1.0.0-alpha', '1.0.0-alpha.1'), -1);
});

test('returns 1 when the first prerelease has more identifiers than the second', () => {
  assert.equal(compareSemver('1.0.0-alpha.1', '1.0.0-alpha'), 1);
});

test('returns -1 when the first numeric prerelease identifier is less than the second', () => {
  assert.equal(compareSemver('1.0.0-1', '1.0.0-2'), -1);
});

test('returns 1 when the first numeric prerelease identifier is greater than the second', () => {
  assert.equal(compareSemver('1.0.0-2', '1.0.0-1'), 1);
});

test('returns -1 when the first prerelease identifier is numeric and the second is alphanumeric', () => {
  assert.equal(compareSemver('1.0.0-1', '1.0.0-alpha'), -1);
});

test('returns 1 when the first prerelease identifier is alphanumeric and the second is numeric', () => {
  assert.equal(compareSemver('1.0.0-alpha', '1.0.0-1'), 1);
});

test('returns -1 when the first alphanumeric prerelease identifier is lexicographically less', () => {
  assert.equal(compareSemver('1.0.0-alpha', '1.0.0-beta'), -1);
});

test('returns 1 when the first alphanumeric prerelease identifier is lexicographically greater', () => {
  assert.equal(compareSemver('1.0.0-beta', '1.0.0-alpha'), 1);
});
