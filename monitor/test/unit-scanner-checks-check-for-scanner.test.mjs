// Maps a scanner category key to its manifest check name, or null if the key is unknown (monitor/scanner-checks.mjs checkForScanner).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkForScanner } from '../scanner-checks.mjs';

test('returns the manifest check name for a known category key', () => {
  assert.equal(checkForScanner('sastCodeqlCpp'), "sast-codeql-cpp");
});

test('returns the manifest check name for a category whose value differs from its key', () => {
  assert.equal(checkForScanner('secrets'), "secrets-gitleaks");
});

test('returns null for a category string that is not a key in the map', () => {
  assert.equal(checkForScanner('not-a-scanner'), null);
});

test('returns null for the string constructor property name', () => {
  assert.equal(checkForScanner('constructor'), null);
});

test('returns null for the string prototype property name', () => {
  assert.equal(checkForScanner('__proto__'), null);
});

test('returns null for an empty string', () => {
  assert.equal(checkForScanner(''), null);
});

test('returns null for a long repeated string that is not a key', () => {
  assert.equal(checkForScanner('x'.repeat(64)), null);
});

test('returns null for a key-like string with a trailing space', () => {
  assert.equal(checkForScanner('sastCodeqlCpp '), null);
});
