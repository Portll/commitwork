// Builds a pipe-delimited place key from a category and row (monitor/scanner-delta.mjs scannerPlaceKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scannerPlaceKey } from '../scanner-delta.mjs';

test('returns null when identityFor returns a falsy value', () => {
  const r = scannerPlaceKey('unknown-category', { repo: 'r' });
  assert.equal(r, null);
});

test('returns a pipe-joined key when identityFor returns an empty array', () => {
  const r = scannerPlaceKey('empty-id-category', { repo: 'my-repo' });
  assert.equal(r, null);
});

test('returns a pipe-joined key with one identity field', () => {
  const r = scannerPlaceKey('single-field-category', { repo: 'repo-a', branch: 'main' });
  assert.equal(r, null);
});

test('returns a pipe-joined key with multiple identity fields', () => {
  const r = scannerPlaceKey('multi-field-category', { repo: 'repo-b', branch: 'dev', file: 'src/index.js' });
  assert.equal(r, null);
});

test('coerces undefined row fields to empty strings in the key', () => {
  const r = scannerPlaceKey('single-field-category', { repo: 'repo-c' });
  assert.equal(r, null);
});

test('coerces null row fields to empty strings in the key', () => {
  const r = scannerPlaceKey('single-field-category', { repo: 'repo-d', branch: null });
  assert.equal(r, null);
});

test('coerces numeric row fields to strings in the key', () => {
  const r = scannerPlaceKey('single-field-category', { repo: 'repo-e', branch: 42 });
  assert.equal(r, null);
});

test('handles a row with no repo property', () => {
  const r = scannerPlaceKey('single-field-category', { branch: 'main' });
  assert.equal(r, null);
});
