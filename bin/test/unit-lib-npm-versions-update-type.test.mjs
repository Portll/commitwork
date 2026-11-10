// Determines the semantic version update type between locked and candidate versions (bin/lib/npm-versions.mjs updateType).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateType } from '../lib/npm-versions.mjs';

test('returns null when locked version is invalid', () => {
  const r = updateType('not-a-version', '1.0.0');
  assert.equal(r, null);
});

test('returns null when candidate version is invalid', () => {
  const r = updateType('1.0.0', 'not-a-version');
  assert.equal(r, null);
});

test('returns major when major versions differ', () => {
  const r = updateType('1.0.0', '2.0.0');
  assert.equal(r, "major");
});

test('returns patch when both are 0.0.x with same patch', () => {
  const r = updateType('0.0.1', '0.0.1');
  assert.equal(r, "patch");
});

test('returns major when 0.0.x locked and candidate has different minor', () => {
  const r = updateType('0.0.1', '0.1.0');
  assert.equal(r, "major");
});

test('returns major when 0.0.x locked and candidate has different patch', () => {
  const r = updateType('0.0.1', '0.0.2');
  assert.equal(r, "major");
});

test('returns major when 0.x locked and minor differs', () => {
  const r = updateType('0.1.0', '0.2.0');
  assert.equal(r, "major");
});

test('returns minor when non-zero major and minor differs', () => {
  const r = updateType('1.1.0', '1.2.0');
  assert.equal(r, "minor");
});

test('returns patch when same major and minor', () => {
  const r = updateType('1.1.0', '1.1.5');
  assert.equal(r, "patch");
});
