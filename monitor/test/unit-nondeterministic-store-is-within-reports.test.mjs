// Checks if a path is inside the reports root (monitor/nondeterministic-store.mjs isWithinReports).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWithinReports } from '../nondeterministic-store.mjs';

test('returns true for a path directly inside the reports root', () => {
  const result = isWithinReports('/repo/reports/file.txt', '/repo/reports');
  assert.equal(result, true);
});

test('returns true for a path in a nested directory inside the reports root', () => {
  const result = isWithinReports('/repo/reports/sub/dir/file.txt', '/repo/reports');
  assert.equal(result, true);
});

test('returns false for a path outside the reports root', () => {
  const result = isWithinReports('/repo/other/file.txt', '/repo/reports');
  assert.equal(result, false);
});

test('returns true for the reports root itself', () => {
  const result = isWithinReports('/repo/reports', '/repo/reports');
  assert.equal(result, true);
});

test('returns false for a sibling directory with a similar name', () => {
  const result = isWithinReports('/repo/reports-foo/file.txt', '/repo/reports');
  assert.equal(result, false);
});

test('returns true when the path is the reports root with a trailing slash', () => {
  const result = isWithinReports('/repo/reports/', '/repo/reports');
  assert.equal(result, true);
});

test('returns true for a file in the reports root when root has trailing slash', () => {
  const result = isWithinReports('/repo/reports/file.txt', '/repo/reports/');
  assert.equal(result, true);
});

test('returns false for a path in a parent directory of the reports root', () => {
  const result = isWithinReports('/repo/file.txt', '/repo/reports');
  assert.equal(result, false);
});

test('returns true for a deeply nested path inside the reports root', () => {
  const result = isWithinReports('/repo/reports/a/b/c/d/e.txt', '/repo/reports');
  assert.equal(result, true);
});

test('returns false for a path that is a prefix of the reports root', () => {
  const result = isWithinReports('/repo/re', '/repo/reports');
  assert.equal(result, false);
});
