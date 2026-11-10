// Expands sandbox path prefixes to absolute paths (bin/lib/sandbox.mjs expandSandboxPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandSandboxPath } from '../lib/sandbox.mjs';

test('expands tilde prefix to home directory', () => {
  const r = expandSandboxPath('~/foo', { home: '/home/u', repoPath: '/repo' });
  assert.equal(r, "/home/u/foo");
});

test('expands tilde alone to home directory', () => {
  const r = expandSandboxPath('~', { home: '/home/u', repoPath: '/repo' });
  assert.equal(r, "/home/u");
});

test('expands dot prefix to repo path', () => {
  const r = expandSandboxPath('./src', { home: '/home/u', repoPath: '/repo' });
  assert.equal(r, "/repo/src");
});

test('expands dot alone to repo path', () => {
  const r = expandSandboxPath('.', { home: '/home/u', repoPath: '/repo' });
  assert.equal(r, "/repo");
});

test('expands usercache prefix to user cache directory', () => {
  const r = expandSandboxPath('@usercache/mod', { home: '/home/u', repoPath: '/repo', userCacheDir: '/cache' });
  assert.equal(r, "/cache/mod");
});

test('expands usercache alone to user cache directory', () => {
  const r = expandSandboxPath('@usercache', { home: '/home/u', repoPath: '/repo', userCacheDir: '/cache' });
  assert.equal(r, "/cache");
});

test('returns absolute path unchanged', () => {
  const r = expandSandboxPath('/etc/passwd', { home: '/home/u', repoPath: '/repo' });
  assert.equal(r, "/etc/passwd");
});

test('returns relative path unchanged', () => {
  const r = expandSandboxPath('foo/bar', { home: '/home/u', repoPath: '/repo' });
  assert.equal(r, "foo/bar");
});

test('throws for non-string input', () => {
  assert.throws(() => expandSandboxPath(42, { home: '/home/u', repoPath: '/repo' }), {
    name: 'Error',
    message: 'sandbox: extra path must be a string, got 42'
  });
});

test('throws for usercache when host does not report cache dir', () => {
  assert.throws(() => expandSandboxPath('@usercache', { home: '/home/u', repoPath: '/repo', userCacheDir: null }), {
    name: 'Error',
    message: 'sandbox: @usercache names the per-user cache dir, which this host does not report'
  });
});
