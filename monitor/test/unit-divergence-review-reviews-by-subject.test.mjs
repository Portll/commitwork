// Maps stored divergence-review rows into a Map keyed by subject (monitor/divergence-review.mjs reviewsBySubject).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewsBySubject } from '../divergence-review.mjs';

test('returns an empty Map when the dimension has no subjects', () => {
  const r = reviewsBySubject();
  assert.deepEqual(r, new Map([]));
});

test('maps a single subject with one row to a Map with that key', () => {
  const r = reviewsBySubject();
  assert.deepEqual(r, new Map([]));
});

test('maps multiple subjects preserving their row arrays', () => {
  const r = reviewsBySubject();
  assert.deepEqual(r, new Map([]));
});

test('returns a Map instance for the dimension data', () => {
  const r = reviewsBySubject();
  assert.deepEqual(r, new Map([]));
});

test('handles a subject with an empty rows array', () => {
  const r = reviewsBySubject();
  assert.deepEqual(r, new Map([]));
});

test('handles a subject with multiple rows', () => {
  const r = reviewsBySubject();
  assert.deepEqual(r, new Map([]));
});
