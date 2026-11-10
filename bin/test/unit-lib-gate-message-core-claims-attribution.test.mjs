// Detects whether a message claims authorship of changes (bin/lib/gate-message-core.mjs claimsAttribution).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimsAttribution } from '../lib/gate-message-core.mjs';

test('returns false for empty string', () => {
  const r = claimsAttribution('');
  assert.equal(r, false);
});

test('returns false for null input', () => {
  const r = claimsAttribution(null);
  assert.equal(r, false);
});

test('returns false for undefined input', () => {
  const r = claimsAttribution(undefined);
  assert.equal(r, false);
});

test('returns true when text contains "you touched"', () => {
  const r = claimsAttribution('you touched the file');
  assert.equal(r, true);
});

test('returns true when text contains "your changes"', () => {
  const r = claimsAttribution('your changes are here');
  assert.equal(r, true);
});

test('returns true when text contains "is file yours"', () => {
  const r = claimsAttribution('is main.js yours');
  assert.equal(r, true);
});

test('returns true when text contains "these are yours"', () => {
  const r = claimsAttribution('these are yours');
  assert.equal(r, true);
});

test('returns false for neutral text with no attribution claim', () => {
  const r = claimsAttribution('the build passed successfully');
  assert.equal(r, false);
});
