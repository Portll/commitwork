// Maps a fixed-version marker to a human-readable remediation string (monitor/fix-range.mjs remediationForFix).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remediationForFix } from '../fix-range.mjs';

test('returns null when the fixed marker is falsy', () => {
  const r = remediationForFix(null);
  assert.equal(r, null);
});

test('returns null when the fixed marker is an empty string', () => {
  const r = remediationForFix('');
  assert.equal(r, null);
});

test('returns the advisory note when the marker is the word available', () => {
  const r = remediationForFix('available');
  assert.equal(r, "a fix is available; the advisory does not name the fixed version");
});

test('returns a prefixed string when the marker is a concrete version', () => {
  const r = remediationForFix('1.2.3');
  assert.equal(r, "fix available: 1.2.3");
});

test('returns a prefixed string when the marker is a non-empty non-available string', () => {
  const r = remediationForFix('2.0.0');
  assert.equal(r, "fix available: 2.0.0");
});

test('returns a prefixed string when the marker is a long repeated string', () => {
  const r = remediationForFix('x'.repeat(50));
  assert.equal(r, "fix available: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
});

test('returns a prefixed string when the marker is a number-like string', () => {
  const r = remediationForFix('0.1.0');
  assert.equal(r, "fix available: 0.1.0");
});

test('returns a prefixed string when the marker is a single character', () => {
  const r = remediationForFix('a');
  assert.equal(r, "fix available: a");
});
