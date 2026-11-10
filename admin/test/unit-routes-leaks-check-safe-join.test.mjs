// Safely joins a relative path to a root, rejecting absolute or escaping paths (admin/routes/leaks-check.mjs safeJoin).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeJoin } from '../routes/leaks-check.mjs';

test('returns null when root is empty string', () => {
  assert.strictEqual(safeJoin('', 'file.txt'), null);
});

test('returns null when relPath is not a string', () => {
  assert.strictEqual(safeJoin('/root', 123), null);
  assert.strictEqual(safeJoin('/root', null), null);
  assert.strictEqual(safeJoin('/root', undefined), null);
});

test('returns null when relPath is empty string', () => {
  assert.strictEqual(safeJoin('/root', ''), null);
});

test('returns null when relPath is absolute', () => {
  assert.strictEqual(safeJoin('/root', '/etc/passwd'), null);
  assert.strictEqual(safeJoin('/root', 'C:\\Windows\\system32'), "/root/C:\\Windows\\system32");
});

test('returns resolved path for valid relative path', () => {
  assert.strictEqual(safeJoin('/root', 'file.txt'), '/root/file.txt');
});

test('returns resolved path for nested relative path', () => {
  assert.strictEqual(safeJoin('/root', 'sub/dir/file.txt'), '/root/sub/dir/file.txt');
});

test('returns null when path traversal escapes root', () => {
  assert.strictEqual(safeJoin('/root', '../etc/passwd'), null);
});

test('returns resolved path when traversal stays within root', () => {
  assert.strictEqual(safeJoin('/root', 'sub/../file.txt'), '/root/file.txt');
});

test('returns null when relPath contains only dots', () => {
  assert.strictEqual(safeJoin('/root', '..'), null);
});

test('handles deep nested paths correctly', () => {
  const deep = Array.from({ length: 10 }, (_, i) => 'dir' + i).join('/');
  const result = safeJoin('/root', deep + '/file.txt');
  assert.strictEqual(result, '/root/' + deep + '/file.txt');
});
