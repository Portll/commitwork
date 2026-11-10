// Parses CW_DIVERGENCE_REVIEW_MIN into a validated score in [0,1] (monitor/divergence-review.mjs reviewMin).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewMin } from '../divergence-review.mjs';

test('returns the default when the variable is unset', () => {
  assert.deepEqual(reviewMin({}), { ok: true, value: 0.5 });
});

test('returns the default when the variable is an empty string', () => {
  assert.deepEqual(reviewMin({ CW_DIVERGENCE_REVIEW_MIN: '' }), { ok: true, value: 0.5 });
});

test('accepts a valid score at the lower boundary', () => {
  assert.deepEqual(reviewMin({ CW_DIVERGENCE_REVIEW_MIN: '0' }), { ok: true, value: 0 });
});

test('accepts a valid score at the upper boundary', () => {
  assert.deepEqual(reviewMin({ CW_DIVERGENCE_REVIEW_MIN: '1' }), { ok: true, value: 1 });
});

test('accepts a fractional score inside the range', () => {
  assert.deepEqual(reviewMin({ CW_DIVERGENCE_REVIEW_MIN: '0.5' }), { ok: true, value: 0.5 });
});

test('rejects a score above the upper boundary', () => {
  assert.deepEqual(reviewMin({ CW_DIVERGENCE_REVIEW_MIN: '1.5' }), { ok: false, error: "CW_DIVERGENCE_REVIEW_MIN=1.5 is not a score in [0,1]" });
});

test('rejects a score below the lower boundary', () => {
  assert.deepEqual(reviewMin({ CW_DIVERGENCE_REVIEW_MIN: '-0.1' }), { ok: false, error: "CW_DIVERGENCE_REVIEW_MIN=-0.1 is not a score in [0,1]" });
});

test('rejects a non-numeric value', () => {
  assert.deepEqual(reviewMin({ CW_DIVERGENCE_REVIEW_MIN: 'abc' }), { ok: false, error: "CW_DIVERGENCE_REVIEW_MIN=abc is not a score in [0,1]" });
});

test('rejects a non-finite value', () => {
  assert.deepEqual(reviewMin({ CW_DIVERGENCE_REVIEW_MIN: 'Infinity' }), { ok: false, error: "CW_DIVERGENCE_REVIEW_MIN=Infinity is not a score in [0,1]" });
});
