// POSIX shell availability hint (lib/posix-shell.mjs posixShellHint).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posixShellHint } from '../posix-shell.mjs';

test('returns the non-win32 hint when platform is linux', () => {
  const r = posixShellHint('linux');
  assert.equal(r, "POSIX shell (`sh`) not installed or not on PATH");
});

test('returns the non-win32 hint when platform is darwin', () => {
  const r = posixShellHint('darwin');
  assert.equal(r, "POSIX shell (`sh`) not installed or not on PATH");
});

test('returns the win32 hint when platform is win32', () => {
  const r = posixShellHint('win32');
  assert.equal(r, "POSIX shell not installed \u2014 install Git for Windows (`winget install -e --id Git.Git`), which supplies bash.exe, or set CW_POSIX_SHELL to a bash.exe path. WSL is not used: it resolves paths in a separate namespace and would write reports where the caller cannot read them");
});

test('returns the non-win32 hint when platform is freebsd', () => {
  const r = posixShellHint('freebsd');
  assert.equal(r, "POSIX shell (`sh`) not installed or not on PATH");
});

test('returns the non-win32 hint when platform is sunos', () => {
  const r = posixShellHint('sunos');
  assert.equal(r, "POSIX shell (`sh`) not installed or not on PATH");
});

test('returns the non-win32 hint when platform is an empty string', () => {
  const r = posixShellHint('');
  assert.equal(r, "POSIX shell (`sh`) not installed or not on PATH");
});

test('returns the non-win32 hint when platform is a long non-win32 string', () => {
  const r = posixShellHint('x'.repeat(100));
  assert.equal(r, "POSIX shell (`sh`) not installed or not on PATH");
});

test('returns the win32 hint when platform is a long win32 string', () => {
  const r = posixShellHint('win32' + 'x'.repeat(95));
  assert.equal(r, "POSIX shell (`sh`) not installed or not on PATH");
});
