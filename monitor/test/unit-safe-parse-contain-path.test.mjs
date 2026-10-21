// Resolves a path under a root and refuses empty paths and paths that escape or equal the root (monitor/safe-parse.mjs containPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containPath } from '../safe-parse.mjs';

test('returns ok false with why empty path when input is empty string', () => {
  const result = containPath('', '/root');
  assert.deepEqual(result, { ok: false, why: 'empty path' });
});

test('returns ok false with why empty path when input is not a string', () => {
  const result = containPath(null, '/root');
  assert.deepEqual(result, { ok: false, why: 'empty path' });
});

test('returns ok true with resolved path and relative path for relative path inside root', () => {
  const result = containPath('sub/file.txt', '/root');
  assert.equal(result.ok, true);
  assert.equal(result.path, '/root/sub/file.txt');
  assert.equal(result.rel, 'sub/file.txt');
});

test('returns ok true with resolved path and relative path for absolute path inside root', () => {
  const result = containPath('/root/sub/file.txt', '/root');
  assert.equal(result.ok, true);
  assert.equal(result.path, '/root/sub/file.txt');
  assert.equal(result.rel, 'sub/file.txt');
});

test('returns ok false with why path escapes root when relative path uses dot-dot to escape', () => {
  const result = containPath('../secret.txt', '/root');
  assert.equal(result.ok, false);
  assert.equal(result.why, 'path escapes root: "../secret.txt"');
});

test('returns ok false with why path escapes root when absolute path is outside root', () => {
  const result = containPath('/etc/passwd', '/root');
  assert.equal(result.ok, false);
  assert.equal(result.why, 'path escapes root: "/etc/passwd"');
});

test('returns ok false with why path escapes root when path resolves to root itself', () => {
  const result = containPath('.', '/root');
  assert.equal(result.ok, false);
  assert.equal(result.why, 'path escapes root: "."');
});

test('returns ok false with why path escapes root when relative path starts with dot-dot', () => {
  const result = containPath('../..', '/root');
  assert.equal(result.ok, false);
  assert.equal(result.why, 'path escapes root: "../.."');
});
