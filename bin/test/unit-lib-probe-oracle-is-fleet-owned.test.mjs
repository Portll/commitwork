// fleet ownership check (bin/lib/probe-oracle.mjs isFleetOwned).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFleetOwned } from '../lib/probe-oracle.mjs';

test('returns false for null area', () => {
  assert.equal(isFleetOwned(null), false);
});

test('returns false for undefined area', () => {
  assert.equal(isFleetOwned(undefined), false);
});

test('returns false for string area', () => {
  assert.equal(isFleetOwned('fleet'), false);
});

test('returns false for number area', () => {
  assert.equal(isFleetOwned(42), false);
});

test('returns false for boolean area', () => {
  assert.equal(isFleetOwned(true), false);
});

test('returns true for object without thirdParty property', () => {
  assert.equal(isFleetOwned({}), true);
});

test('returns true for object with thirdParty false', () => {
  assert.equal(isFleetOwned({ thirdParty: false }), true);
});

test('returns false for object with thirdParty true', () => {
  assert.equal(isFleetOwned({ thirdParty: true }), false);
});

test('returns true for object with thirdParty null', () => {
  assert.equal(isFleetOwned({ thirdParty: null }), true);
});

test('returns true for object with thirdParty undefined', () => {
  assert.equal(isFleetOwned({ thirdParty: undefined }), true);
});
