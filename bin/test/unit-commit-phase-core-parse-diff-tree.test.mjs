// Parses a null-separated diff tree string into an array of file change objects (bin/commit-phase-core.mjs parseDiffTree).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiffTree } from '../commit-phase-core.mjs';

test('returns an array of change objects for a well\u2011formed diff string', () => {
  const input = ':000001 100644 0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 A\0src/file.txt\0';
  const result = parseDiffTree(input);
  assert.deepEqual(result, [{ path: "src/file.txt", before: null, after: "100644:1111111111111111111111111111111111111111" }]);
});

test('returns an empty array when input is null or undefined', () => {
  const input = null;
  const result = parseDiffTree(input);
  assert.deepEqual(result, []);
});

test('returns null when the parts count is odd', () => {
  const input = 'singlepart';
  const result = parseDiffTree(input);
  assert.equal(result, null);
});

test('pops a trailing empty part and then returns null because the remaining count is odd', () => {
  const input = ':000001 100644 0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 A\0src/file.txt\0';
  const result = parseDiffTree(input);
  assert.deepStrictEqual(result, [{ path: "src/file.txt", before: null, after: "100644:1111111111111111111111111111111111111111" }]);
});

test('returns null when a diff line does not match the expected format', () => {
  const input = ':badformat\0path.txt\0';
  const result = parseDiffTree(input);
  assert.equal(result, null);
});

test('produces null for the before state when the blob hash is all zeros', () => {
  const input = ':000001 100644 0000000000000000000000000000000000000000 ffffffffffffffffffffffffffffffffffffffff A\0file.txt\0';
  const result = parseDiffTree(input);
  assert.deepEqual(result, [{ path: "file.txt", before: null, after: "100644:ffffffffffffffffffffffffffffffffffffffff" }]);
});

test('returns null when the path entry is missing after a diff line', () => {
  const input = ':000001 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 A\0';
  const result = parseDiffTree(input);
  assert.equal(result, null);
});
