// Per-verdict and per-asset review counts (bin/pre-publish.mjs reviewCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewCounts } from '../pre-publish.mjs';

test('returns null when review is null', () => {
  const r = reviewCounts(null);
  assert.deepEqual(r, null);
});

test('returns null when review is undefined', () => {
  const r = reviewCounts(undefined);
  assert.deepEqual(r, null);
});

test('returns null when review is empty string', () => {
  const r = reviewCounts('');
  assert.deepEqual(r, null);
});

test('returns null when review is zero', () => {
  const r = reviewCounts(0);
  assert.deepEqual(r, null);
});

test('returns null when review is false', () => {
  const r = reviewCounts(false);
  assert.deepEqual(r, null);
});

test('computes counts for a fully populated review object', () => {
  const review = {
    source: 'main',
    reviewed: [
      { verdict: 'approve' },
      { verdict: 'approve' },
      { verdict: 'reject' },
      { verdict: 'comment' },
      { verdict: 'other' },
    ],
    unreviewed: [
      { verdict: 'approve' },
      { verdict: 'reject' },
      { verdict: 'reject' },
      { verdict: 'comment' },
      { verdict: 'other' },
    ],
    assetsReviewed: [1, 2, 3],
    assetsUnreviewed: [4, 5],
    stale: [6],
  };
  const r = reviewCounts(review);
  assert.deepEqual(r, { source: "main", reviewed: { "REAL-SECRET": 0, "SENSITIVE-CONTEXT": 0 }, open: { "REAL-SECRET": 0, "SENSITIVE-CONTEXT": 0 }, assetsReviewed: 3, assetsOpen: 2, stale: 1 });
});

test('computes counts when all arrays are empty', () => {
  const review = {
    source: 'dev',
    reviewed: [],
    unreviewed: [],
    assetsReviewed: [],
    assetsUnreviewed: [],
    stale: [],
  };
  const r = reviewCounts(review);
  assert.deepEqual(r, { source: "dev", reviewed: { "REAL-SECRET": 0, "SENSITIVE-CONTEXT": 0 }, open: { "REAL-SECRET": 0, "SENSITIVE-CONTEXT": 0 }, assetsReviewed: 0, assetsOpen: 0, stale: 0 });
});

test('computes counts with single element in each array', () => {
  const review = {
    source: 'feature',
    reviewed: [{ verdict: 'approve' }],
    unreviewed: [{ verdict: 'reject' }],
    assetsReviewed: [10],
    assetsUnreviewed: [20],
    stale: [30],
  };
  const r = reviewCounts(review);
  assert.deepEqual(r, { source: "feature", reviewed: { "REAL-SECRET": 0, "SENSITIVE-CONTEXT": 0 }, open: { "REAL-SECRET": 0, "SENSITIVE-CONTEXT": 0 }, assetsReviewed: 1, assetsOpen: 1, stale: 1 });
});
