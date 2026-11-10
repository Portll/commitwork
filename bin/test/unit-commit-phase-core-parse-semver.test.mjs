// Parses a strict semver 2.0.0 string into major, minor, patch, pre, and build fields (bin/commit-phase-core.mjs parseSemver).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSemver } from '../commit-phase-core.mjs';

test('returns null for non-string input', () => {
  assert.equal(parseSemver(123), null);
});

test('returns null for string with v prefix', () => {
  assert.equal(parseSemver('v1.2.3'), null);
});

test('returns null for string with leading zero in major', () => {
  assert.equal(parseSemver('01.2.3'), null);
});

test('returns null for string with leading zero in minor', () => {
  assert.equal(parseSemver('1.02.3'), null);
});

test('returns null for string with leading zero in patch', () => {
  assert.equal(parseSemver('1.2.03'), null);
});

test('returns null for string with invalid pre-release identifier', () => {
  assert.equal(parseSemver('1.2.3-01'), null);
});

test('returns object with correct fields for simple semver', () => {
  assert.deepEqual(parseSemver('1.2.3'), { major: 1n, minor: 2n, patch: 3n, pre: [], build: null });
});

test('returns object with correct fields for semver with pre-release', () => {
  assert.deepEqual(parseSemver('1.2.3-alpha.1'), { major: 1n, minor: 2n, patch: 3n, pre: ["alpha", "1"], build: null });
});

test('returns object with correct fields for semver with build metadata', () => {
  assert.deepEqual(parseSemver('1.2.3+build.5'), { major: 1n, minor: 2n, patch: 3n, pre: [], build: "build.5" });
});

test('returns object with correct fields for semver with pre-release and build', () => {
  assert.deepEqual(parseSemver('1.2.3-alpha.1+build.5'), { major: 1n, minor: 2n, patch: 3n, pre: ["alpha", "1"], build: "build.5" });
});
