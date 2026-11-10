// Computes a sanitized per-session key from environment variables or pid (bin/commit-phase-core.mjs sessionKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionKey } from '../commit-phase-core.mjs';

test('prefers CW_COMMIT_SESSION over other session variables', () => {
  const env = { CW_COMMIT_SESSION: 'cw', CLAUDE_CODE_SESSION_ID: 'cc', CLAUDE_SESSION_ID: 'cs' };
  assert.equal(sessionKey(env, 123), 'cw');
});

test('falls back to CLAUDE_CODE_SESSION_ID when CW_COMMIT_SESSION is absent', () => {
  const env = { CLAUDE_CODE_SESSION_ID: 'cc', CLAUDE_SESSION_ID: 'cs' };
  assert.equal(sessionKey(env, 123), 'cc');
});

test('falls back to CLAUDE_SESSION_ID when higher-priority variables are absent', () => {
  const env = { CLAUDE_SESSION_ID: 'cs' };
  assert.equal(sessionKey(env, 123), 'cs');
});

test('falls back to pid when no session variables are present', () => {
  assert.equal(sessionKey({}, 123), 'pid-123');
});

test('sanitizes unsafe characters to dashes', () => {
  const env = { CW_COMMIT_SESSION: 'a b/c' };
  assert.equal(sessionKey(env, 1), 'a-b-c');
});

test('strips leading dots and dashes', () => {
  const env = { CW_COMMIT_SESSION: '..-abc' };
  assert.equal(sessionKey(env, 1), 'abc');
});

test('truncates key to 64 characters', () => {
  const env = { CW_COMMIT_SESSION: 'x'.repeat(100) };
  assert.equal(sessionKey(env, 1), 'x'.repeat(64));
});

test('falls back to pid when sanitized key is empty', () => {
  const env = { CW_COMMIT_SESSION: '...' };
  assert.equal(sessionKey(env, 42), 'pid-42');
});

test('preserves dots and dashes in the middle of the key', () => {
  const env = { CW_COMMIT_SESSION: 'a.b-c' };
  assert.equal(sessionKey(env, 1), 'a.b-c');
});

test('uses the first character of a long key after sanitization', () => {
  const env = { CW_COMMIT_SESSION: 'a' + 'b'.repeat(100) };
  assert.equal(sessionKey(env, 1), 'a' + 'b'.repeat(63));
});
