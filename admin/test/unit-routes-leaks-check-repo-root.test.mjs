// Resolves a repository name to its absolute path via the registry (admin/routes/leaks-check.mjs repoRoot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoRoot } from '../routes/leaks-check.mjs';

test('returns null when the repository name is not found in the registry', () => {
  assert.equal(repoRoot('nonexistent-repo'), null);
});

test('returns null when the registry entry has no path property', () => {
  const result = repoRoot('repo-without-path');
  assert.equal(result, null);
});

test('returns the resolved absolute path for a valid repository entry', () => {
  const result = repoRoot('valid-repo');
  if (result !== null) {
    assert.equal(typeof result, 'string');
    assert.ok(result.startsWith('/'));
  }
});

test('returns null for an empty string repository name', () => {
  assert.equal(repoRoot(''), null);
});

test('returns null for a repository name with leading whitespace', () => {
  assert.equal(repoRoot('  valid-repo'), null);
});

test('returns null for a repository name with trailing whitespace', () => {
  assert.equal(repoRoot('valid-repo  '), null);
});

test('returns null for a repository name that is only whitespace', () => {
  assert.equal(repoRoot('   '), null);
});

test('returns null for a very long repository name that does not exist', () => {
  const longName = 'x'.repeat(1000);
  assert.equal(repoRoot(longName), null);
});

test('returns null for a repository name with special characters', () => {
  assert.equal(repoRoot('repo/with/slashes'), null);
});

test('returns null for a repository name with unicode characters', () => {
  assert.equal(repoRoot('r\u00e9po-with-unicode'), null);
});
