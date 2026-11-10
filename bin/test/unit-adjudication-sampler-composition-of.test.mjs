// Computes per-stratum counts, shares, dominant stratum, and label for a gate's records (bin/adjudication-sampler.mjs compositionOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compositionOf } from '../adjudication-sampler.mjs';

test('returns zero total and null shares for empty records', () => {
  const r = compositionOf('turn-gate', []);
  assert.equal(r.total, 0);
  assert.deepEqual(r.counts, { clean: 0, alarm: 0, neither: 0, unclassified: 0 });
  assert.deepEqual(r.shares, { clean: null, alarm: null, neither: null, unclassified: null });
  assert.equal(r.dominant, null);
  assert.equal(r.label, 'no records');
});

test('classifies pass as clean with share 1', () => {
  const r = compositionOf('turn-gate', [{ outcome: 'pass' }]);
  assert.equal(r.total, 1);
  assert.equal(r.counts.clean, 1);
  assert.equal(r.shares.clean, 1);
  assert.deepEqual(r.dominant, { stratum: 'clean', count: 1, share: 1 });
  assert.equal(r.label, 'clean 1/1');
});

test('classifies block as alarm', () => {
  const r = compositionOf('turn-gate', [{ outcome: 'block' }]);
  assert.equal(r.counts.alarm, 1);
  assert.equal(r.shares.alarm, 1);
  assert.equal(r.dominant.stratum, 'alarm');
});

test('classifies unknown as neither', () => {
  const r = compositionOf('turn-gate', [{ outcome: 'unknown' }]);
  assert.equal(r.counts.neither, 1);
  assert.equal(r.shares.neither, 1);
  assert.equal(r.dominant.stratum, 'neither');
});

test('classifies unlisted verdict as unclassified', () => {
  const r = compositionOf('turn-gate', [{ outcome: 'weird' }]);
  assert.equal(r.counts.unclassified, 1);
  assert.equal(r.shares.unclassified, 1);
  assert.equal(r.dominant.stratum, 'unclassified');
});

test('classifies missing verdict field as unclassified', () => {
  const r = compositionOf('turn-gate', [{}]);
  assert.equal(r.counts.unclassified, 1);
  assert.equal(r.dominant.stratum, 'unclassified');
});

test('classifies null verdict as unclassified', () => {
  const r = compositionOf('turn-gate', [{ outcome: null }]);
  assert.equal(r.counts.unclassified, 1);
});

test('computes mixed shares and dominant correctly', () => {
  const recs = [
    { outcome: 'pass' },
    { outcome: 'pass' },
    { outcome: 'block' },
    { outcome: 'unknown' },
    { outcome: 'weird' },
  ];
  const r = compositionOf('turn-gate', recs);
  assert.equal(r.total, 5);
  assert.deepEqual(r.counts, { clean: 2, alarm: 1, neither: 1, unclassified: 1 });
  assert.equal(r.shares.clean, 0.4);
  assert.equal(r.shares.alarm, 0.2);
  assert.equal(r.shares.neither, 0.2);
  assert.equal(r.shares.unclassified, 0.2);
  assert.deepEqual(r.dominant, { stratum: 'clean', count: 2, share: 0.4 });
  assert.equal(r.label, 'clean 2/5, alarm 1/5, neither 1/5, unclassified 1/5');
});

test('handles gate-spine boolean verdict with identity match', () => {
  const r = compositionOf('gate-spine', [{ verdict: 'below-threshold' }]);
  assert.equal(r.counts.clean, 1);
  assert.equal(r.shares.clean, 1);
});

test('handles gate-spine alarm verdict', () => {
  const r = compositionOf('gate-spine', [{ verdict: 'no-spine-record' }]);
  assert.equal(r.counts.alarm, 1);
  assert.equal(r.shares.alarm, 1);
});
