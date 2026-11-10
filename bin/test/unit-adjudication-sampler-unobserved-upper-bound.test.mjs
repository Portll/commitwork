// Computes an upper bound on the fraction of unobserved items (bin/adjudication-sampler.mjs unobservedUpperBound).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unobservedUpperBound } from '../adjudication-sampler.mjs';

test('returns 1 when n is zero', () => {
  assert.equal(unobservedUpperBound(0, 0), 1);
});

test('returns 1 when n is negative', () => {
  assert.equal(unobservedUpperBound(5, -1), 1);
});

test('returns 1 when n is a large negative number', () => {
  assert.equal(unobservedUpperBound(0, -100), 1);
});

test('returns min(1, 3/n) when k is zero and n is positive', () => {
  assert.equal(unobservedUpperBound(0, 3), 1);
});

test('returns 3/n when k is zero and n is greater than 3', () => {
  assert.equal(unobservedUpperBound(0, 6), 0.5);
});

test('returns 3/n when k is zero and n is 10', () => {
  assert.equal(unobservedUpperBound(0, 10), 0.3);
});

test('returns null when k is positive and n is positive', () => {
  assert.equal(unobservedUpperBound(1, 10), null);
});

test('returns null when k is large and n is positive', () => {
  assert.equal(unobservedUpperBound(100, 50), null);
});

test('returns 1 when k is zero and n is 1', () => {
  assert.equal(unobservedUpperBound(0, 1), 1);
});

test('returns 3/n when k is zero and n is 2', () => {
  assert.equal(unobservedUpperBound(0, 2), 1);
});
