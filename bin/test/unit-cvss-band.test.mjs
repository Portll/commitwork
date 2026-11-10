// Maps a CVSS score to a severity band label (bin/cvss.mjs band).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { band } from '../cvss.mjs';

test('returns empty string for null score', () => {
  const r = band(null);
  assert.equal(r, "");
});

test('returns empty string for undefined score', () => {
  const r = band(undefined);
  assert.equal(r, "");
});

test('returns empty string for NaN score', () => {
  const r = band(NaN);
  assert.equal(r, "");
});

test('returns crit for score 9 with default version', () => {
  const r = band(9);
  assert.equal(r, "crit");
});

test('returns high for score 9 with version 2.0', () => {
  const r = band(9, '2.0');
  assert.equal(r, "high");
});

test('returns high for score 7 with default version', () => {
  const r = band(7);
  assert.equal(r, "high");
});

test('returns med for score 4 with default version', () => {
  const r = band(4);
  assert.equal(r, "med");
});

test('returns low for score 0.1 with default version', () => {
  const r = band(0.1);
  assert.equal(r, "low");
});

test('returns none for score 0 with default version', () => {
  const r = band(0);
  assert.equal(r, "none");
});
