// Computes the path to a private index file inside a git directory (bin/commit-phase-core.mjs privateIndexPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateIndexPath } from '../commit-phase-core.mjs';

test('returns the joined path for a simple key', () => {
  const result = privateIndexPath('/repo/.git', 'main');
  assert.equal(result, '/repo/.git/index.main');
});

test('returns the joined path for a key with a dot', () => {
  const result = privateIndexPath('/repo/.git', 'v1.2');
  assert.equal(result, '/repo/.git/index.v1.2');
});

test('returns the joined path for a key with a slash', () => {
  const result = privateIndexPath('/repo/.git', 'a/b');
  assert.equal(result, '/repo/.git/index.a/b');
});

test('returns the joined path for an empty key', () => {
  const result = privateIndexPath('/repo/.git', '');
  assert.equal(result, '/repo/.git/index.');
});

test('returns the joined path for a key with spaces', () => {
  const result = privateIndexPath('/repo/.git', 'my key');
  assert.equal(result, '/repo/.git/index.my key');
});

test('returns the joined path for a long repeated key', () => {
  const key = 'x'.repeat(100);
  const result = privateIndexPath('/repo/.git', key);
  assert.equal(result, '/repo/.git/index.' + 'x'.repeat(100));
});

test('returns the joined path for a key with special characters', () => {
  const result = privateIndexPath('/repo/.git', '!@#$%^&*');
  assert.equal(result, '/repo/.git/index.!@#$%^&*');
});

test('returns the joined path for a numeric key', () => {
  const result = privateIndexPath('/repo/.git', '12345');
  assert.equal(result, '/repo/.git/index.12345');
});
