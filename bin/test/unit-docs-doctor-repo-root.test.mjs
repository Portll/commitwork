// absolute path of the repository root (bin/docs-doctor.mjs repoRoot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoRoot } from '../docs-doctor.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const testDir = dirname(fileURLToPath(import.meta.url));
const expectedRepoRoot = resolve(testDir, '..', '..');

test('returns the resolved parent directory of the module', () => {
  const result = repoRoot();
  assert.equal(result, expectedRepoRoot);
});

test('returns the repository root path as a string', () => {
  const result = repoRoot();
  assert.equal(result, expectedRepoRoot);
});

test('returns the absolute path to the repository root', () => {
  const result = repoRoot();
  assert.equal(result, expectedRepoRoot);
});

test('returns the parent of the bin directory', () => {
  const result = repoRoot();
  assert.equal(result, expectedRepoRoot);
});

test('returns the same path on each invocation', () => {
  const result = repoRoot();
  assert.equal(result, expectedRepoRoot);
});
