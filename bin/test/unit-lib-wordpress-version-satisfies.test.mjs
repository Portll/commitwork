// Checks whether a version satisfies a comparison operator against another version (bin/lib/wordpress.mjs versionSatisfies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionSatisfies } from '../lib/wordpress.mjs';

test('returns true when the first version is less than the second', () => {
  const r = versionSatisfies('1.0.0', 'lt', '1.0.1');
  assert.equal(r, true);
});

test('returns false when the first version is greater than the second', () => {
  const r = versionSatisfies('1.0.1', 'lt', '1.0.0');
  assert.equal(r, false);
});

test('returns false when the versions are equal for lt', () => {
  const r = versionSatisfies('1.0.0', 'lt', '1.0.0');
  assert.equal(r, false);
});

test('returns true when the first version is less than or equal to the second', () => {
  const r = versionSatisfies('1.0.0', 'le', '1.0.1');
  assert.equal(r, true);
});

test('returns true when the versions are equal for le', () => {
  const r = versionSatisfies('1.0.0', 'le', '1.0.0');
  assert.equal(r, true);
});

test('returns true when the first version is greater than the second', () => {
  const r = versionSatisfies('1.0.1', 'gt', '1.0.0');
  assert.equal(r, true);
});

test('returns false when the versions are equal for gt', () => {
  const r = versionSatisfies('1.0.0', 'gt', '1.0.0');
  assert.equal(r, false);
});

test('returns true when the first version is greater than or equal to the second', () => {
  const r = versionSatisfies('1.0.1', 'ge', '1.0.0');
  assert.equal(r, true);
});

test('returns true when the versions are equal for ge', () => {
  const r = versionSatisfies('1.0.0', 'ge', '1.0.0');
  assert.equal(r, true);
});

test('returns true when the versions are equal for eq', () => {
  const r = versionSatisfies('1.0.0', 'eq', '1.0.0');
  assert.equal(r, true);
});

test('returns false when the versions differ for eq', () => {
  const r = versionSatisfies('1.0.0', 'eq', '1.0.1');
  assert.equal(r, false);
});

test('returns true when the versions differ for ne', () => {
  const r = versionSatisfies('1.0.0', 'ne', '1.0.1');
  assert.equal(r, true);
});

test('returns false when the versions are equal for ne', () => {
  const r = versionSatisfies('1.0.0', 'ne', '1.0.0');
  assert.equal(r, false);
});

test('returns null for an unknown operator', () => {
  const r = versionSatisfies('1.0.0', 'bogus', '1.0.1');
  assert.equal(r, null);
});
