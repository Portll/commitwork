// Checks if a package spec is pinned to a version (bin/agent-config.mjs isPinned).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPinned } from '../agent-config.mjs';

test('returns true for a simple package name with a version number', () => {
  assert.equal(isPinned('lodash@4.17.21'), true);
});

test('returns true for a scoped package name with a version number', () => {
  assert.equal(isPinned('@babel/core@7.22.0'), true);
});

test('returns true for a version starting with v followed by a digit', () => {
  assert.equal(isPinned('pkg@v1.0.0'), true);
});

test('returns false for a package name without a version', () => {
  assert.equal(isPinned('lodash'), false);
});

test('returns false for a version that does not start with a digit or v', () => {
  assert.equal(isPinned('pkg@latest'), false);
});

test('returns false for a version that starts with a letter other than v', () => {
  assert.equal(isPinned('pkg@x1.0.0'), false);
});

test('returns false for a version that starts with v but no digit', () => {
  assert.equal(isPinned('pkg@v'), false);
});

test('returns false for an empty string', () => {
  assert.equal(isPinned(''), false);
});

test('returns false for null input', () => {
  assert.equal(isPinned(null), false);
});

test('returns false for undefined input', () => {
  assert.equal(isPinned(undefined), false);
});
