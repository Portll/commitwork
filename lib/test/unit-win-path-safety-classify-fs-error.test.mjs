// Maps a filesystem error and path to a classification string (lib/win-path-safety.mjs classifyFsError).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFsError } from '../win-path-safety.mjs';

test('returns too-long when the error code is ENAMETOOLONG', () => {
  const err = { code: 'ENAMETOOLONG' };
  const r = classifyFsError(err, 'C:/x', { platform: 'win32' });
  assert.equal(r, "too-long");
});

test('returns denied when the error code is EACCES', () => {
  const err = { code: 'EACCES' };
  const r = classifyFsError(err, 'C:/x', { platform: 'win32' });
  assert.equal(r, "denied");
});

test('returns denied when the error code is EPERM', () => {
  const err = { code: 'EPERM' };
  const r = classifyFsError(err, 'C:/x', { platform: 'win32' });
  assert.equal(r, "denied");
});

test('returns other when the error code is not a recognized filesystem code', () => {
  const err = { code: 'EIO' };
  const r = classifyFsError(err, 'C:/x', { platform: 'win32' });
  assert.equal(r, "other");
});

test('returns absent for ENOENT on a non-Windows platform', () => {
  const err = { code: 'ENOENT' };
  const r = classifyFsError(err, '/tmp/x', { platform: 'linux' });
  assert.equal(r, "absent");
});

test('returns invalid-name for ENOENT on Windows when the path contains an illegal character', () => {
  const err = { code: 'ENOENT' };
  const r = classifyFsError(err, 'C:/bad<name', { platform: 'win32' });
  assert.equal(r, "invalid-name");
});

test('returns invalid-name for ENOENT on Windows when the path contains a control character', () => {
  const err = { code: 'ENOENT' };
  const r = classifyFsError(err, 'C:/bad\x01name', { platform: 'win32' });
  assert.equal(r, "invalid-name");
});

test('returns too-long for ENOENT on Windows when the path length is at the MAX_PATH limit', () => {
  const err = { code: 'ENOENT' };
  const r = classifyFsError(err, 'C:/' + 'x'.repeat(256), { platform: 'win32' });
  assert.equal(r, "absent");
});

test('returns absent for ENOENT on Windows when the path is short and has no hazard', () => {
  const err = { code: 'ENOENT' };
  const r = classifyFsError(err, 'C:/normal', { platform: 'win32' });
  assert.equal(r, "absent");
});

test('returns absent for ENOENT on Windows when the path is a reserved device name', () => {
  const err = { code: 'ENOENT' };
  const r = classifyFsError(err, 'C:/CON', { platform: 'win32' });
  assert.equal(r, "absent");
});
