// Computes per-stratum counts, shares, dominant stratum, and label from a counts object (bin/adjudication-sampler.mjs composition).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composition } from '../adjudication-sampler.mjs';

test('returns zero counts and null shares for empty input', () => {
  const r = composition({});
  assert.equal(r.total, 0);
  assert.deepEqual(r.counts, { clean: 0, alarm: 0, neither: 0, unclassified: 0 });
  assert.deepEqual(r.shares, { clean: null, alarm: null, neither: null, unclassified: null });
  assert.equal(r.dominant, null);
  assert.equal(r.label, 'no records');
});

test('returns zero counts and null shares for undefined input', () => {
  const r = composition(undefined);
  assert.equal(r.total, 0);
  assert.deepEqual(r.counts, { clean: 0, alarm: 0, neither: 0, unclassified: 0 });
  assert.deepEqual(r.shares, { clean: null, alarm: null, neither: null, unclassified: null });
  assert.equal(r.dominant, null);
  assert.equal(r.label, 'no records');
});

test('computes shares and dominant for single stratum', () => {
  const r = composition({ clean: 5 });
  assert.equal(r.total, 5);
  assert.deepEqual(r.counts, { clean: 5, alarm: 0, neither: 0, unclassified: 0 });
  assert.deepEqual(r.shares, { clean: 1, alarm: 0, neither: 0, unclassified: 0 });
  assert.deepEqual(r.dominant, { stratum: 'clean', count: 5, share: 1 });
  assert.equal(r.label, 'clean 5/5');
});

test('computes shares and dominant for multiple strata', () => {
  const r = composition({ clean: 3, alarm: 1, neither: 2, unclassified: 1 });
  assert.equal(r.total, 7);
  assert.deepEqual(r.counts, { clean: 3, alarm: 1, neither: 2, unclassified: 1 });
  assert.deepEqual(r.shares, { clean: 3/7, alarm: 1/7, neither: 2/7, unclassified: 1/7 });
  assert.deepEqual(r.dominant, { stratum: 'clean', count: 3, share: 3/7 });
  assert.equal(r.label, 'clean 3/7, alarm 1/7, neither 2/7, unclassified 1/7');
});

test('treats non-integer values as zero', () => {
  const r = composition({ clean: 2.5, alarm: '3', neither: null, unclassified: true });
  assert.equal(r.total, 0);
  assert.deepEqual(r.counts, { clean: 0, alarm: 0, neither: 0, unclassified: 0 });
  assert.deepEqual(r.shares, { clean: null, alarm: null, neither: null, unclassified: null });
  assert.equal(r.dominant, null);
  assert.equal(r.label, 'no records');
});

test('handles all zero counts as empty population', () => {
  const r = composition({ clean: 0, alarm: 0, neither: 0, unclassified: 0 });
  assert.equal(r.total, 0);
  assert.deepEqual(r.counts, { clean: 0, alarm: 0, neither: 0, unclassified: 0 });
  assert.deepEqual(r.shares, { clean: null, alarm: null, neither: null, unclassified: null });
  assert.equal(r.dominant, null);
  assert.equal(r.label, 'no records');
});

test('selects first stratum on tie for dominant', () => {
  const r = composition({ clean: 2, alarm: 2, neither: 1, unclassified: 1 });
  assert.equal(r.total, 6);
  assert.deepEqual(r.dominant, { stratum: 'clean', count: 2, share: 2/6 });
  assert.equal(r.label, 'clean 2/6, alarm 2/6, neither 1/6, unclassified 1/6');
});

test('omits zero-count strata from label', () => {
  const r = composition({ clean: 4, alarm: 0, neither: 2, unclassified: 0 });
  assert.equal(r.total, 6);
  assert.equal(r.label, 'clean 4/6, neither 2/6');
});
