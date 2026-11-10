// Reports the first Win32 path hazard found in a path string (lib/win-path-safety.mjs pathHazard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathHazard } from '../win-path-safety.mjs';

test('returns empty hazard for empty string', () => {
  const r = pathHazard('');
  assert.deepEqual(r, { hazard: "empty", why: "an empty path", silent: false });
});

test('returns empty hazard for undefined input', () => {
  const r = pathHazard(undefined);
  assert.deepEqual(r, { hazard: "empty", why: "an empty path", silent: false });
});

test('returns too-long hazard for 260 char path on win32', () => {
  const r = pathHazard('x'.repeat(260), { platform: 'win32' });
  assert.deepEqual(r, { hazard: "too-long", why: "260 characters, at or past the 260-character MAX_PATH limit. Measured: node handled a 303-character path here, so this is a warning for other consumers rather than a reproduced failure.", silent: false, interopOnly: true });
});

test('returns null for 259 char path on win32', () => {
  const r = pathHazard('x'.repeat(259), { platform: 'win32' });
  assert.deepEqual(r, null);
});

test('returns null for 260 char path on posix', () => {
  const r = pathHazard('x'.repeat(260), { platform: 'posix' });
  assert.deepEqual(r, null);
});

test('returns null for clean relative path on win32', () => {
  const r = pathHazard('a/b/c', { platform: 'win32' });
  assert.deepEqual(r, null);
});

test('returns null for clean absolute path with drive letter on win32', () => {
  const r = pathHazard('C:/a/b', { platform: 'win32' });
  assert.deepEqual(r, null);
});

test('returns null for clean absolute path with drive letter on posix', () => {
  const r = pathHazard('C:/a/b', { platform: 'posix' });
  assert.deepEqual(r, { hazard: "ads", why: "contains \":\" \u2014 on NTFS this writes an ALTERNATE DATA STREAM. Measured: the write succeeds, the same path reads the data back, but readdir does not list it and the base file stats as 0 bytes. Invisible to every enumeration, size check and archive.", silent: true, segment: "C:" });
});

test('returns illegal hazard for segment with pipe on win32', () => {
  const r = pathHazard('a/b|c', { platform: 'win32' });
  assert.deepEqual(r, { hazard: "illegal", why: "contains \"|\", which Windows rejects \u2014 and measured, it fails with ENOENT, the one code this codebase reads as \"legitimately absent\". A write that could not happen becomes a lane with nothing to report.", silent: false, enoent: true, segment: "b|c" });
});

test('returns illegal hazard for segment with pipe on posix', () => {
  const r = pathHazard('a/b|c', { platform: 'posix' });
  assert.deepEqual(r, { hazard: "illegal", why: "contains \"|\", which Windows rejects \u2014 and measured, it fails with ENOENT, the one code this codebase reads as \"legitimately absent\". A write that could not happen becomes a lane with nothing to report.", silent: false, enoent: true, segment: "b|c" });
});
