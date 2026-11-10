// Checks whether any path segment of repoPath matches a skip token (lib/repo-walk.mjs isSkipped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSkipped } from '../repo-walk.mjs';

test('returns false when skip is undefined', () => {
  const r = isSkipped('src/index.js', undefined);
  assert.equal(r, false);
});

test('returns false when skip is an empty array', () => {
  const r = isSkipped('src/index.js', []);
  assert.equal(r, false);
});

test('returns true when a skip token matches the last path segment', () => {
  const r = isSkipped('src/index.js', ['index.js']);
  assert.equal(r, true);
});

test('returns true when a skip token matches an interior path segment', () => {
  const r = isSkipped('src/utils/helper.js', ['utils']);
  assert.equal(r, true);
});

test('returns false when no skip token matches any path segment', () => {
  const r = isSkipped('src/index.js', ['other']);
  assert.equal(r, false);
});

test('returns true when a skip token matches the first path segment', () => {
  const r = isSkipped('node_modules/pkg/index.js', ['node_modules']);
  assert.equal(r, true);
});

test('returns false when skip is null', () => {
  const r = isSkipped('src/index.js', null);
  assert.equal(r, false);
});

test('returns true when multiple tokens are provided and one matches', () => {
  const r = isSkipped('src/utils/helper.js', ['nope', 'utils', 'also-nope']);
  assert.equal(r, true);
});
