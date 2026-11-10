// Builds a pipe-delimited identity key from repo, id, and package (bin/lib/verdict-journal-core.mjs findingKeyForDependency).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findingKeyForDependency } from '../lib/verdict-journal-core.mjs';

test('joins repo, id, and package with pipes', () => {
  const r = findingKeyForDependency('myrepo', 'dep-1', 'lodash');
  assert.equal(r, "myrepo|dep-1|lodash");
});

test('handles empty strings for all components', () => {
  const r = findingKeyForDependency('', '', '');
  assert.equal(r, "||");
});

test('handles single character components', () => {
  const r = findingKeyForDependency('a', 'b', 'c');
  assert.equal(r, "a|b|c");
});

test('handles long repeated characters in components', () => {
  const r = findingKeyForDependency('x'.repeat(10), 'y'.repeat(10), 'z'.repeat(10));
  assert.equal(r, "xxxxxxxxxx|yyyyyyyyyy|zzzzzzzzzz");
});

test('handles components with special characters', () => {
  const r = findingKeyForDependency('repo/with/slashes', 'id-with-dashes', 'pkg@1.0.0');
  assert.equal(r, "repo/with/slashes|id-with-dashes|pkg@1.0.0");
});

test('handles components with spaces', () => {
  const r = findingKeyForDependency('my repo', 'my id', 'my package');
  assert.equal(r, "my repo|my id|my package");
});

test('handles unicode characters in components', () => {
  const r = findingKeyForDependency('r\u00e9po', 'id\u00e9', 'p\u00e0ckage');
  assert.equal(r, "r\u00e9po|id\u00e9|p\u00e0ckage");
});

test('handles numeric-looking strings in components', () => {
  const r = findingKeyForDependency('123', '456', '789');
  assert.equal(r, "123|456|789");
});
