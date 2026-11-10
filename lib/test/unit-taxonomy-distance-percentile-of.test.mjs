// Computes the percentile rank of a value within a sorted array (lib/taxonomy-distance.mjs percentileOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentileOf } from '../taxonomy-distance.mjs';

test('returns null for an empty array', () => {
  const r = percentileOf([], 5);
  assert.equal(r, null);
});

test('returns 0 when value is less than or equal to the smallest element', () => {
  const r = percentileOf([1, 2, 3, 4], 1);
  assert.equal(r, 0);
});

test('returns 25 when value is greater than exactly one element', () => {
  const r = percentileOf([1, 2, 3, 4], 2);
  assert.equal(r, 25);
});

test('returns 50 when value is greater than exactly two elements', () => {
  const r = percentileOf([1, 2, 3, 4], 3);
  assert.equal(r, 50);
});

test('returns 100 when value is greater than all elements', () => {
  const r = percentileOf([1, 2, 3, 4], 5);
  assert.equal(r, 100);
});

test('returns 0 when value equals the only element', () => {
  const r = percentileOf([7], 7);
  assert.equal(r, 0);
});

test('returns 100 when value is greater than the only element', () => {
  const r = percentileOf([7], 8);
  assert.equal(r, 100);
});

test('returns 50 for a value between two equal elements', () => {
  const r = percentileOf([5, 5], 5);
  assert.equal(r, 0);
});
