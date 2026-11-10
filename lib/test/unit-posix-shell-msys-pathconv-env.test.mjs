// Returns MSYS path-conversion environment variables for the given platform (lib/posix-shell.mjs msysPathconvEnv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { msysPathconvEnv } from '../posix-shell.mjs';

test('returns MSYS env vars when platform is win32', () => {
  const result = msysPathconvEnv('win32');
  assert.deepEqual(result, { MSYS_NO_PATHCONV: "1", MSYS2_ARG_CONV_EXCL: "*" });
});

test('returns empty object when platform is linux', () => {
  const result = msysPathconvEnv('linux');
  assert.deepEqual(result, {});
});

test('returns empty object when platform is darwin', () => {
  const result = msysPathconvEnv('darwin');
  assert.deepEqual(result, {});
});

test('returns empty object when platform is freebsd', () => {
  const result = msysPathconvEnv('freebsd');
  assert.deepEqual(result, {});
});

test('returns empty object when platform is empty string', () => {
  const result = msysPathconvEnv('');
  assert.deepEqual(result, {});
});

test('returns empty object when platform is win32 with different case', () => {
  const result = msysPathconvEnv('Win32');
  assert.deepEqual(result, {});
});

test('returns empty object when platform is win32 with extra characters', () => {
  const result = msysPathconvEnv('win32 ');
  assert.deepEqual(result, {});
});
