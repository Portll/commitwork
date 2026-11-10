// Resolves the divergence review timeout in milliseconds from env (monitor/divergence-review.mjs reviewTimeoutMs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewTimeoutMs } from '../divergence-review.mjs';

test('returns the env value when it is a positive finite number', () => {
  const r = reviewTimeoutMs({ CW_DIVERGENCE_REVIEW_TIMEOUT_MS: '120000' });
  assert.equal(r, 120000);
});

test('returns the default when the env value is zero', () => {
  const r = reviewTimeoutMs({ CW_DIVERGENCE_REVIEW_TIMEOUT_MS: '0' });
  assert.equal(r, 600000);
});

test('returns the default when the env value is negative', () => {
  const r = reviewTimeoutMs({ CW_DIVERGENCE_REVIEW_TIMEOUT_MS: '-5' });
  assert.equal(r, 600000);
});

test('returns the default when the env value is one', () => {
  const r = reviewTimeoutMs({ CW_DIVERGENCE_REVIEW_TIMEOUT_MS: '1' });
  assert.equal(r, 1);
});

test('returns the default when the env value is two', () => {
  const r = reviewTimeoutMs({ CW_DIVERGENCE_REVIEW_TIMEOUT_MS: '2' });
  assert.equal(r, 2);
});

test('returns the default when the env value is not a number', () => {
  const r = reviewTimeoutMs({ CW_DIVERGENCE_REVIEW_TIMEOUT_MS: 'abc' });
  assert.equal(r, 600000);
});

test('returns the default when the env value is NaN', () => {
  const r = reviewTimeoutMs({ CW_DIVERGENCE_REVIEW_TIMEOUT_MS: 'NaN' });
  assert.equal(r, 600000);
});

test('returns the default when the env value is Infinity', () => {
  const r = reviewTimeoutMs({ CW_DIVERGENCE_REVIEW_TIMEOUT_MS: 'Infinity' });
  assert.equal(r, 600000);
});

test('returns the default when the env value is negative Infinity', () => {
  const r = reviewTimeoutMs({ CW_DIVERGENCE_REVIEW_TIMEOUT_MS: '-Infinity' });
  assert.equal(r, 600000);
});

test('returns the default when the env value is missing', () => {
  const r = reviewTimeoutMs({});
  assert.equal(r, 600000);
});
