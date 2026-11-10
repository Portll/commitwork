// Formats a human-readable suffix describing the outcome of a process-tree kill (lib/proc-tree.mjs describeKill).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeKill } from '../proc-tree.mjs';

test('returns an empty string when the result is falsy', () => {
  assert.equal(describeKill(null), "");
});

test('returns the already-exited suffix when ok and alreadyGone are both true', () => {
  assert.equal(describeKill({ ok: true, alreadyGone: true, survived: false, error: 'err' }), "; the process had already exited");
});

test('returns an empty string when ok is true, alreadyGone is false, and survived is false', () => {
  assert.equal(describeKill({ ok: true, alreadyGone: false, survived: false, error: 'err' }), "");
});

test('returns the leader-killed warning when ok is true and survived is true', () => {
  assert.equal(describeKill({ ok: true, alreadyGone: false, survived: true, error: 'EPIPE' }), "; WARNING: only the leader was killed (EPIPE) \u2014 child processes may still be running and writing");
});

test('returns the kill-failed warning when ok is false and survived is true', () => {
  assert.equal(describeKill({ ok: false, alreadyGone: false, survived: true, error: 'ESRCH' }), "; WARNING: the kill FAILED (ESRCH) \u2014 the process tree may still be running and writing into the report directory");
});

test('returns the kill-failed warning when ok is false and alreadyGone is true', () => {
  assert.equal(describeKill({ ok: false, alreadyGone: true, survived: false, error: 'ENOENT' }), "; WARNING: the kill FAILED (ENOENT) \u2014 the process tree may still be running and writing into the report directory");
});

test('returns the kill-failed warning when ok is false and survived is false', () => {
  assert.equal(describeKill({ ok: false, alreadyGone: false, survived: false, error: 'EACCES' }), "; WARNING: the kill FAILED (EACCES) \u2014 the process tree may still be running and writing into the report directory");
});
