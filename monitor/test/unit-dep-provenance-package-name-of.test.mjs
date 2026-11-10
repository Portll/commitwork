// Extracts the package name from a dependency spec (monitor/dep-provenance.mjs packageNameOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packageNameOf } from '../dep-provenance.mjs';

test('returns empty string for empty string input', () => {
  const r = packageNameOf('');
  assert.equal(r, "");
});

test('returns empty string for null input', () => {
  const r = packageNameOf(null);
  assert.equal(r, "");
});

test('returns empty string for undefined input', () => {
  const r = packageNameOf(undefined);
  assert.equal(r, "");
});

test('returns full name for spec without version', () => {
  const r = packageNameOf('lodash');
  assert.equal(r, "lodash");
});

test('returns package name for scoped package with version', () => {
  const r = packageNameOf('@scope/pkg@1.0.0');
  assert.equal(r, "@scope/pkg");
});

test('returns full name for spec with at sign at start', () => {
  const r = packageNameOf('@1.0.0');
  assert.equal(r, "@1.0.0");
});

test('returns package name for spec with at sign at index one', () => {
  const r = packageNameOf('a@1.0.0');
  assert.equal(r, "a");
});

test('strips surrounding quotes before extracting name', () => {
  const r = packageNameOf('"lodash@4.17.21"');
  assert.equal(r, "lodash");
});
