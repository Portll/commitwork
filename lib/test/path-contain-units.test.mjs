// lib/test/path-contain-units.test.mjs — case tests for relativePosix, relativeWithin, withinRoot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { relativePosix, relativeWithin, withinRoot } from '../path-contain.mjs';

test('returns null when p is outside root', () => {
  assert.equal(relativePosix('/repo', '/other/file.txt'), null);
});

test('returns null when p is a sibling with similar prefix', () => {
  assert.equal(relativePosix('/repo', '/repo-evil/file.txt'), null);
});

test('returns null for null or undefined inputs', () => {
  assert.equal(relativePosix(null, '/repo/file.txt'), null);
  assert.equal(relativePosix('/repo', undefined), null);
});

test('returns empty string when p equals root', () => {
  assert.equal(relativePosix('/repo', '/repo'), '');
});

test('returns posix path for nested file', () => {
  assert.equal(relativePosix('/repo', '/repo/src/index.js'), 'src/index.js');
});

test('returns posix path for deeply nested file', () => {
  assert.equal(relativePosix('/repo', '/repo/a/b/c.txt'), 'a/b/c.txt');
});

test('returns null when p is parent of root', () => {
  assert.equal(relativePosix('/repo/sub', '/repo'), null);
});

test('returns null when p is in different directory tree', () => {
  assert.equal(relativePosix('/repo', '/srv/other/file.txt'), null);
});

test('returns empty string when p equals root', () => {
  assert.equal(relativeWithin('/repo', '/repo'), '');
});

test('returns relative path for child inside root', () => {
  assert.equal(relativeWithin('/repo', '/repo/src/index.js'), 'src/index.js');
});

test('returns null when p is outside root', () => {
  assert.equal(relativeWithin('/repo', '/other/file.js'), null);
});

test('returns null when p escapes via dotdot', () => {
  assert.equal(relativeWithin('/repo', '/repo/../etc/passwd'), null);
});

test('returns null for sibling prefix trap', () => {
  assert.equal(relativeWithin('/repo', '/repo-evil/file.js'), null);
});

test('returns null when root is null', () => {
  assert.equal(relativeWithin(null, '/repo/file.js'), null);
});

test('returns null when p is undefined', () => {
  assert.equal(relativeWithin('/repo', undefined), null);
});

test('returns null for empty string inputs', () => {
  assert.equal(relativeWithin('', '/repo'), null);
  assert.equal(relativeWithin('/repo', ''), null);
});

test('returns true when p is the same as root', () => {
  assert.equal(withinRoot('/repo', '/repo'), true);
});

test('returns true when p is inside root', () => {
  assert.equal(withinRoot('/repo', '/repo/src/index.js'), true);
});

test('returns false when p is outside root', () => {
  assert.equal(withinRoot('/repo', '/other/file.js'), false);
});

test('returns false when p escapes via ..', () => {
  assert.equal(withinRoot('/repo', '/repo/../etc/passwd'), false);
});

test('returns false when p is a sibling with similar prefix', () => {
  assert.equal(withinRoot('/repo', '/repo-evil/file.js'), false);
});

test('returns false for null or undefined inputs', () => {
  assert.equal(withinRoot(null, '/repo'), false);
  assert.equal(withinRoot('/repo', undefined), false);
});

test('returns false for empty strings', () => {
  assert.equal(withinRoot('', '/repo'), false);
  assert.equal(withinRoot('/repo', ''), false);
});
