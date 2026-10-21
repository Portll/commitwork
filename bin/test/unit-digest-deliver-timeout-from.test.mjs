// Computes the digest delivery timeout in ms from CW_DIGEST_TIMEOUT_MS, clamped to [1000, 60000] (bin/digest-deliver.mjs timeoutFrom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeoutFrom } from '../digest-deliver.mjs';

test('returns 10000 when CW_DIGEST_TIMEOUT_MS is undefined', () => {
  assert.equal(timeoutFrom({}), 10000);
});

test('returns 10000 when CW_DIGEST_TIMEOUT_MS is an empty string', () => {
  assert.equal(timeoutFrom({ CW_DIGEST_TIMEOUT_MS: '' }), 10000);
});

test('returns 10000 when CW_DIGEST_TIMEOUT_MS is null', () => {
  assert.equal(timeoutFrom({ CW_DIGEST_TIMEOUT_MS: null }), 10000);
});

test('returns 1000 when CW_DIGEST_TIMEOUT_MS is below the minimum', () => {
  assert.equal(timeoutFrom({ CW_DIGEST_TIMEOUT_MS: '500' }), 1000);
});

test('returns 1000 when CW_DIGEST_TIMEOUT_MS equals the minimum', () => {
  assert.equal(timeoutFrom({ CW_DIGEST_TIMEOUT_MS: '1000' }), 1000);
});

test('returns 60000 when CW_DIGEST_TIMEOUT_MS is above the maximum', () => {
  assert.equal(timeoutFrom({ CW_DIGEST_TIMEOUT_MS: '100000' }), 60000);
});

test('returns 60000 when CW_DIGEST_TIMEOUT_MS equals the maximum', () => {
  assert.equal(timeoutFrom({ CW_DIGEST_TIMEOUT_MS: '60000' }), 60000);
});

test('returns the value when CW_DIGEST_TIMEOUT_MS is within bounds', () => {
  assert.equal(timeoutFrom({ CW_DIGEST_TIMEOUT_MS: '5000' }), 5000);
});

test('throws RangeError when CW_DIGEST_TIMEOUT_MS is not a whole number', () => {
  assert.throws(() => timeoutFrom({ CW_DIGEST_TIMEOUT_MS: 'abc' }), RangeError);
});

test('throws RangeError when CW_DIGEST_TIMEOUT_MS is a negative number', () => {
  assert.throws(() => timeoutFrom({ CW_DIGEST_TIMEOUT_MS: '-100' }), RangeError);
});
