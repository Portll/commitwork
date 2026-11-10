// Extracts up to three path-like tokens from a command string (admin/lib/spine-preconditions.mjs commandPaths).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandPaths } from '../lib/spine-preconditions.mjs';

test('returns empty array for empty string', () => {
  assert.deepEqual(commandPaths(''), []);
});

test('returns empty array for null input', () => {
  assert.deepEqual(commandPaths(null), []);
});

test('returns empty array for undefined input', () => {
  assert.deepEqual(commandPaths(undefined), []);
});

test('returns empty array for whitespace-only string', () => {
  assert.deepEqual(commandPaths('   '), []);
});

test('skips tokens without slash', () => {
  assert.deepEqual(commandPaths('ls -la'), []);
});

test('skips tokens starting with dash', () => {
  assert.deepEqual(commandPaths('--flag /usr/bin/tool'), ["/usr/bin/tool"]);
});

test('includes single path token with slash', () => {
  assert.deepEqual(commandPaths('/usr/bin/node'), ['/usr/bin/node']);
});

test('includes multiple path tokens up to three', () => {
  assert.deepEqual(commandPaths('/a/b /c/d /e/f'), ['/a/b', '/c/d', '/e/f']);
});

test('stops at quoted token', () => {
  assert.deepEqual(commandPaths('/a/b "/c/d" /e/f'), ['/a/b']);
});

test('stops at single-quoted token', () => {
  assert.deepEqual(commandPaths('/a/b \'/c/d\' /e/f'), ['/a/b']);
});

test('expands tilde prefix', () => {
  const result = commandPaths('~/bin/tool');
  assert.equal(result.length, 1);
  assert.ok(result[0].endsWith('/bin/tool'));
});

test('expands dollar HOME prefix', () => {
  const result = commandPaths('$HOME/bin/tool');
  assert.equal(result.length, 1);
  assert.ok(result[0].endsWith('/bin/tool'));
});

test('expands brace HOME prefix', () => {
  const result = commandPaths('${HOME}/bin/tool');
  assert.equal(result.length, 1);
  assert.ok(result[0].endsWith('/bin/tool'));
});

test('returns empty for token with newline', () => {
  assert.deepEqual(commandPaths('/a/b\n/c/d'), ["/a/b", "/c/d"]);
});

test('limits to first three tokens', () => {
  assert.deepEqual(commandPaths('/a/b /c/d /e/f /g/h'), ['/a/b', '/c/d', '/e/f']);
});
