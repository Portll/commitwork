// Checks if a string matches a public advisory identifier format (monitor/cwx-registry.mjs isPublicAdvisory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAdvisory } from '../cwx-registry.mjs';

test('returns true for a valid CVE identifier', () => {
  const r = isPublicAdvisory('CVE-2021-44228');
  assert.equal(r, true);
});

test('returns true for a valid GHSA identifier', () => {
  const r = isPublicAdvisory('GHSA-8h45-g43j-r9v7');
  assert.equal(r, true);
});

test('returns false for a string that is neither CVE nor GHSA', () => {
  const r = isPublicAdvisory('INVALID-1234');
  assert.equal(r, false);
});

test('returns false for a CVE with too few digits in the second part', () => {
  const r = isPublicAdvisory('CVE-2021-123');
  assert.equal(r, false);
});

test('returns false for a GHSA with uppercase letters', () => {
  const r = isPublicAdvisory('GHSA-ABCD-EFGH-IJKL');
  assert.equal(r, false);
});

test('returns false for a CVE with non-numeric characters', () => {
  const r = isPublicAdvisory('CVE-2021-ABCD');
  assert.equal(r, false);
});

test('returns false for a GHSA with wrong segment length', () => {
  const r = isPublicAdvisory('GHSA-123-456-789');
  assert.equal(r, false);
});

test('returns false for an empty string', () => {
  const r = isPublicAdvisory('');
  assert.equal(r, false);
});

test('returns false for a string with trailing whitespace after a valid CVE', () => {
  const r = isPublicAdvisory('CVE-2021-44228 ');
  assert.equal(r, false);
});

test('returns false for a string with leading whitespace before a valid GHSA', () => {
  const r = isPublicAdvisory(' GHSA-8h45-g43j-r9v7');
  assert.equal(r, false);
});
