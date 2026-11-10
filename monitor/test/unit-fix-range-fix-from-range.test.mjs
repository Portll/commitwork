// Extracts the version bound from a semver range (monitor/fix-range.mjs fixFromRange).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixFromRange } from '../fix-range.mjs';

test('returns empty string for non-string input', () => {
  assert.equal(fixFromRange(123), "");
});

test('returns empty string when no version bound is present', () => {
  assert.equal(fixFromRange('>=1.0.0'), "");
});

test('returns version when bound is less-than without equals', () => {
  assert.equal(fixFromRange('<1.0.0'), "1.0.0");
});

test('returns greater-than version when bound is less-than-equals', () => {
  assert.equal(fixFromRange('<=2.0.0'), ">2.0.0");
});

test('returns empty string when two version bounds are present', () => {
  assert.equal(fixFromRange('<1.0.0 <2.0.0'), "");
});

test('returns version when bound includes v prefix', () => {
  assert.equal(fixFromRange('<v1.0.0'), "1.0.0");
});

test('returns version when bound includes whitespace before version', () => {
  assert.equal(fixFromRange('< 1.0.0'), "1.0.0");
});

test('returns version when bound is less-than-equals with v prefix', () => {
  assert.equal(fixFromRange('<=v3.0.0'), ">3.0.0");
});
