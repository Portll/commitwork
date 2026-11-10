// Maps git push stderr text to a failure category (bin/anchor-witness.mjs classifyPushFailure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPushFailure } from '../anchor-witness.mjs';

test('returns diverged for non-fast-forward rejection', () => {
  assert.equal(classifyPushFailure('! [rejected] main -> main (non-fast-forward)'), 'diverged');
});

test('returns diverged for fetch first message', () => {
  assert.equal(classifyPushFailure('error: [remote origin] fetch first'), 'diverged');
});

test('returns diverged for stale info message', () => {
  assert.equal(classifyPushFailure('error: Your local changes were not based on the latest remote. stale info'), 'diverged');
});

test('returns not-permitted for authentication failure', () => {
  assert.equal(classifyPushFailure('fatal: Authentication failed for https://github.com/user/repo.git'), 'not-permitted');
});

test('returns not-permitted for permission denied', () => {
  assert.equal(classifyPushFailure('fatal: Could not read from remote repository. Permission denied'), 'not-permitted');
});

test('returns not-permitted for 403 status', () => {
  assert.equal(classifyPushFailure('HTTP 403 Forbidden'), 'not-permitted');
});

test('returns offline for could not resolve host', () => {
  assert.equal(classifyPushFailure('fatal: unable to access: Could not resolve host: github.com'), 'offline');
});

test('returns offline for connection refused', () => {
  assert.equal(classifyPushFailure('fatal: unable to access: Connection refused'), 'offline');
});

test('returns offline for operation timed out', () => {
  assert.equal(classifyPushFailure('fatal: The remote end hung up unexpectedly. Operation timed out'), 'offline');
});

test('returns push-failed for unrecognized error', () => {
  assert.equal(classifyPushFailure('fatal: some unknown error occurred'), 'push-failed');
});
