// Maps declared paths to the scope names whose prefixes cover them (bin/lib/conventional-commit.mjs scopesFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopesFor } from '../lib/conventional-commit.mjs';

test('returns an empty array when no path matches any scope prefix', () => {
  assert.deepEqual(scopesFor(['zzz/unknown.txt']), []);
});

test('returns the scope name when a path equals a prefix exactly', () => {
  assert.deepEqual(scopesFor(['README.md']), ["docs", "readme"]);
});

test('returns the scope name when a path starts with a prefix', () => {
  assert.deepEqual(scopesFor(['bin/lib/conventional-commit.mjs']), ["bin", "commit-phase"]);
});

test('returns multiple scope names when paths match multiple scopes', () => {
  assert.deepEqual(scopesFor(['bin/lib/conventional-commit.mjs', 'docs/README.md']), ["bin", "docs", "commit-phase"]);
});

test('returns an empty array when paths is an empty array', () => {
  assert.deepEqual(scopesFor([]), []);
});

test('returns the scope name when a path matches a prefix with a trailing slash', () => {
  assert.deepEqual(scopesFor(['admin/routes/comments.js']), ["admin", "comments"]);
});

test('returns an empty array when a path is a prefix but not under it', () => {
  assert.deepEqual(scopesFor(['bin']), []);
});

test('returns the scope name when a path matches a non-slash prefix', () => {
  assert.deepEqual(scopesFor(['package.json']), ["deps"]);
});
