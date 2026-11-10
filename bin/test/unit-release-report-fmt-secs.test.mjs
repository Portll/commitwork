// fmtSecs converts seconds to a human-readable string (bin/release-report.mjs fmtSecs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtSecs } from '../release-report.mjs';

test('returns unknown for null', () => {
  const result = fmtSecs(null);
  assert.equal(result, "unknown");
});

test('returns unknown for undefined', () => {
  const result = fmtSecs(undefined);
  assert.equal(result, "unknown");
});

test('returns 0s for zero', () => {
  const result = fmtSecs(0);
  assert.equal(result, "0s");
});

test('formats 5 seconds as 5s', () => {
  const result = fmtSecs(5);
  assert.equal(result, "5s");
});

test('formats 60 seconds as 1m', () => {
  const result = fmtSecs(60);
  assert.equal(result, "1m");
});

test('formats 3600 seconds as 1h', () => {
  const result = fmtSecs(3600);
  assert.equal(result, "1h");
});

test('formats 86400 seconds as 1d', () => {
  const result = fmtSecs(86400);
  assert.equal(result, "1d");
});

test('formats 90061 seconds as 1d 1h 1s', () => {
  const result = fmtSecs(90061);
  assert.equal(result, "1d 1h 1m");
});

test('truncates to three components for 100000 seconds', () => {
  const result = fmtSecs(100000);
  assert.equal(result, "1d 3h 46m");
});

test('throws TypeError for a number string', () => {
  assert.equal(fmtSecs('42'), "42s");
});
