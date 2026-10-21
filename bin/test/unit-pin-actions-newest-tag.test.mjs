// Computes the newest semver tag from a list of [tag, sha] pairs, optionally filtered by major version (bin/pin-actions.mjs newestTag).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newestTag } from '../pin-actions.mjs';

test('returns the highest version tag when multiple tags are provided', () => {
  const tags = [
    ['v1.0.0', 'sha1'],
    ['v2.0.0', 'sha2'],
    ['v1.5.0', 'sha3'],
  ];
  const result = newestTag(tags);
  assert.deepEqual(result, { tag: 'v2.0.0', sha: 'sha2', v: [2, 0, 0, 1] });
});

test('returns null when no tags are provided', () => {
  const result = newestTag([]);
  assert.equal(result, null);
});

test('returns null when all tags are invalid semver', () => {
  const tags = [
    ['not-a-version', 'sha1'],
    ['abc', 'sha2'],
  ];
  const result = newestTag(tags);
  assert.equal(result, null);
});

test('filters by major version when major is specified', () => {
  const tags = [
    ['v1.0.0', 'sha1'],
    ['v2.0.0', 'sha2'],
    ['v1.5.0', 'sha3'],
  ];
  const result = newestTag(tags, 1);
  assert.deepEqual(result, { tag: 'v1.5.0', sha: 'sha3', v: [1, 5, 0, 1] });
});

test('returns null when no tags match the specified major version', () => {
  const tags = [
    ['v1.0.0', 'sha1'],
    ['v2.0.0', 'sha2'],
  ];
  const result = newestTag(tags, 3);
  assert.equal(result, null);
});

test('prefers the fully-qualified tag over the bare major tag of the same major', () => {
  const tags = [
    ['v4', 'sha1'],
    ['v4.3.0', 'sha2'],
  ];
  const result = newestTag(tags);
  assert.deepEqual(result, { tag: 'v4.3.0', sha: 'sha2', v: [4, 3, 0, 1] });
});

test('handles tags without minor or patch versions', () => {
  const tags = [
    ['v3', 'sha1'],
    ['v2.1.0', 'sha2'],
  ];
  const result = newestTag(tags);
  assert.deepEqual(result, { tag: 'v3', sha: 'sha1', v: [3, 0, 0, 0] });
});

test('compares minor versions when major is equal', () => {
  const tags = [
    ['v1.2.0', 'sha1'],
    ['v1.10.0', 'sha2'],
    ['v1.9.0', 'sha3'],
  ];
  const result = newestTag(tags);
  assert.deepEqual(result, { tag: 'v1.10.0', sha: 'sha2', v: [1, 10, 0, 1] });
});

test('compares patch versions when major and minor are equal', () => {
  const tags = [
    ['v1.2.3', 'sha1'],
    ['v1.2.10', 'sha2'],
    ['v1.2.9', 'sha3'],
  ];
  const result = newestTag(tags);
  assert.deepEqual(result, { tag: 'v1.2.10', sha: 'sha2', v: [1, 2, 10, 1] });
});

test('handles tags with only major and minor versions', () => {
  const tags = [
    ['v1.2', 'sha1'],
    ['v1.10', 'sha2'],
  ];
  const result = newestTag(tags);
  assert.deepEqual(result, { tag: 'v1.10', sha: 'sha2', v: [1, 10, 0, 1] });
});
