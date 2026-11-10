// Parses a version string into major, minor, patch, and pre-release parts (bin/lib/npm-versions.mjs parseVersion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion } from '../lib/npm-versions.mjs';

test('parses a simple version without pre-release', () => {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, pre: [] });
});

test('parses a version with a v prefix', () => {
  assert.deepEqual(parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3, pre: [] });
});

test('parses a version with a single pre-release identifier', () => {
  assert.deepEqual(parseVersion('1.2.3-alpha'), { major: 1, minor: 2, patch: 3, pre: ["alpha"] });
});

test('parses a version with multiple dot-separated pre-release identifiers', () => {
  assert.deepEqual(parseVersion('1.2.3-alpha.1'), { major: 1, minor: 2, patch: 3, pre: ["alpha", "1"] });
});

test('parses a version with a build metadata suffix', () => {
  assert.deepEqual(parseVersion('1.2.3+build.123'), { major: 1, minor: 2, patch: 3, pre: [] });
});

test('parses a version with both pre-release and build metadata', () => {
  assert.deepEqual(parseVersion('1.2.3-alpha.1+build.123'), { major: 1, minor: 2, patch: 3, pre: ["alpha", "1"] });
});

test('returns null for an invalid version string', () => {
  assert.equal(parseVersion('not-a-version'), null);
});

test('returns null for null input', () => {
  assert.equal(parseVersion(null), null);
});

test('returns null for undefined input', () => {
  assert.equal(parseVersion(undefined), null);
});

test('trims whitespace before parsing', () => {
  assert.deepEqual(parseVersion('  1.2.3  '), { major: 1, minor: 2, patch: 3, pre: [] });
});
