// Computes the on-disk path for a session transcript file (admin/lib/session-view.mjs transcriptPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptPath } from '../lib/session-view.mjs';

test('returns null when ids is null', () => {
  assert.equal(transcriptPath(null, { root: '/root' }), null);
});

test('returns null when ids is undefined', () => {
  assert.equal(transcriptPath(undefined, { root: '/root' }), null);
});

test('returns null when transcript is missing', () => {
  assert.equal(transcriptPath({ cwd: '/home/user' }, { root: '/root' }), null);
});

test('returns null when cwd is missing', () => {
  assert.equal(transcriptPath({ transcript: 'abc-123' }, { root: '/root' }), null);
});

test('returns null when transcript is not a string', () => {
  assert.equal(transcriptPath({ transcript: 123, cwd: '/home/user' }, { root: '/root' }), null);
});

test('returns null when cwd is not a string', () => {
  assert.equal(transcriptPath({ transcript: 'abc-123', cwd: 456 }, { root: '/root' }), null);
});

test('returns joined path with valid transcript and cwd', () => {
  const result = transcriptPath({ transcript: 'abc-123', cwd: '/home/user' }, { root: '/root' });
  assert.equal(result, '/root/-home-user/abc-123.jsonl');
});

test('replaces dots and slashes in cwd with dashes', () => {
  const result = transcriptPath({ transcript: 'xyz', cwd: '/var/www/.config' }, { root: '/data' });
  assert.equal(result, '/data/-var-www--config/xyz.jsonl');
});

test('handles empty cwd string', () => {
  const result = transcriptPath({ transcript: 'id1', cwd: '' }, { root: '/base' });
  assert.equal(result, null);
});

test('handles cwd with multiple dots and slashes', () => {
  const result = transcriptPath({ transcript: 't1', cwd: 'a/b/c.d/e' }, { root: '/r' });
  assert.equal(result, '/r/a-b-c-d-e/t1.jsonl');
});
