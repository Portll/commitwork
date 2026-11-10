// Filters credential-touching paths and normalizes egress posture (bin/lib/isolation.mjs probePosture).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probePosture } from '../lib/isolation.mjs';

test('returns null for non-record inputs', () => {
  assert.equal(probePosture(null), null);
});

test('returns null for array inputs', () => {
  assert.equal(probePosture([]), null);
});

test('returns null for string inputs', () => {
  assert.equal(probePosture('string'), null);
});

test('returns null for number inputs', () => {
  assert.equal(probePosture(42), null);
});

test('returns null for boolean inputs', () => {
  assert.equal(probePosture(true), null);
});

test('returns null for undefined inputs', () => {
  assert.equal(probePosture(undefined), null);
});

test('returns null for function inputs', () => {
  assert.equal(probePosture(() => {}), null);
});

test('returns null for symbol inputs', () => {
  assert.equal(probePosture(Symbol('test')), null);
});

test('returns null for bigint inputs', () => {
  assert.equal(probePosture(10n), null);
});

test('returns null for object with prototype', () => {
  const obj = Object.create(null);
  assert.deepStrictEqual(probePosture(obj), { platform: undefined, egress: undefined, cwRoot: undefined, nodePrefix: undefined, developerDir: null, userCacheDir: null, extraReads: [], extraWrites: [] });
});
