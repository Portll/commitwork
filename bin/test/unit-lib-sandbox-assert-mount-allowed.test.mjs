// Validates that a host path is safe to mount into the sandbox (bin/lib/sandbox.mjs assertMountAllowed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertMountAllowed } from '../lib/sandbox.mjs';

test('rejects the filesystem root', () => {
  assert.throws(() => assertMountAllowed('/'), {
    name: 'Error',
    message: 'sandbox: refusing to mount the filesystem root',
  });
});

test('rejects a forbidden mount point exactly', () => {
  assert.throws(() => assertMountAllowed('/etc'), {
    name: 'Error',
    message: 'sandbox: refusing to mount /etc \u2014 /etc is host-equivalent and no posture may opt into it',
  });
});

test('rejects a path under a forbidden mount point', () => {
  assert.throws(() => assertMountAllowed('/etc/passwd'), {
    name: 'Error',
    message: 'sandbox: refusing to mount /etc/passwd \u2014 /etc is host-equivalent and no posture may opt into it',
  });
});

test('rejects a path containing a forbidden credential segment', () => {
  assert.throws(() => assertMountAllowed('/home/user/.ssh'), {
    name: 'Error',
    message: 'sandbox: refusing to mount /home/user/.ssh \u2014 it contains credential material (.ssh)',
  });
});

test('rejects a Windows-style path containing a forbidden credential segment', () => {
  assert.throws(() => assertMountAllowed('C:\\Users\\me\\.ssh'), {
    name: 'Error',
    message: 'sandbox: refusing to mount C:/Users/me/.ssh \u2014 it contains credential material (.ssh)',
  });
});

test('allows a safe path', () => {
  assert.equal(assertMountAllowed('/home/user/project'), true);
});

test('allows a path with trailing slashes', () => {
  assert.equal(assertMountAllowed('/home/user/project/'), true);
});

test('allows a path that looks like a forbidden prefix but is not under it', () => {
  assert.equal(assertMountAllowed('/etc-backup'), true);
});
