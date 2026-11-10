// Computes the repo-relative path from a file path and repo root (bin/lib/sarif-export.mjs repoRelative).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoRelative } from '../lib/sarif-export.mjs';

test('returns empty string for null path', () => {
  const r = repoRelative(null, '/repo');
  assert.equal(r, "");
});

test('returns empty string for empty string path', () => {
  const r = repoRelative('', '/repo');
  assert.equal(r, "");
});

test('returns empty string for undefined path', () => {
  const r = repoRelative(undefined, '/repo');
  assert.equal(r, "");
});

test('returns empty string for path with file scheme', () => {
  const r = repoRelative('file:///repo/src/x.js', '/repo');
  assert.equal(r, "src/x.js");
});

test('returns empty string for absolute path outside repo root', () => {
  const r = repoRelative('/other/src/x.js', '/repo');
  assert.equal(r, "");
});

test('returns empty string for Windows drive path', () => {
  const r = repoRelative('C:/src/x.js', '/repo');
  assert.equal(r, "");
});

test('returns relative path for path inside repo root', () => {
  const r = repoRelative('/repo/src/x.js', '/repo');
  assert.equal(r, "src/x.js");
});

test('returns empty string for dot-dot path', () => {
  const r = repoRelative('../x.js', '/repo');
  assert.equal(r, "");
});

test('returns empty string for path starting with dot-slash', () => {
  const r = repoRelative('./src/x.js', '/repo');
  assert.equal(r, "src/x.js");
});

test('returns relative path for simple relative path', () => {
  const r = repoRelative('src/x.js', '/repo');
  assert.equal(r, "src/x.js");
});
