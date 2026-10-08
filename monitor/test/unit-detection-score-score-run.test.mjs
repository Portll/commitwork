// Computes per-set collapse rates and error counts for a scored run (monitor/detection-score.mjs scoreRun).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRun } from '../detection-score.mjs';

test('returns zero totals and null rates for an empty results array', () => {
  const out = scoreRun([]);
  assert.deepEqual(out, {
    total: 0,
    errors: 0,
    errorRate: 0,
    lob: { n: 0, rate: null },
    heldout: { n: 0, rate: null },
    positive: { n: 0, rate: null, dismissed: [] },
    buckets: { lob: [], heldout: [], positive: [], other: [] },
  });
});

test('counts a failed result as an error and excludes it from all buckets', () => {
  const out = scoreRun([{ ok: false, item: { set: 'lob', collapseMode: 'strict', id: 'x' } }]);
  assert.equal(out.total, 1);
  assert.equal(out.errors, 1);
  assert.equal(out.errorRate, 1);
  assert.equal(out.lob.n, 0);
  assert.equal(out.lob.rate, null);
  assert.equal(out.heldout.n, 0);
  assert.equal(out.heldout.rate, null);
  assert.equal(out.positive.n, 0);
  assert.equal(out.positive.rate, null);
  assert.deepEqual(out.positive.dismissed, []);
  assert.deepEqual(out.buckets, { lob: [], heldout: [], positive: [], other: [] });
});

test('scores a strict lob item classified false-positive as correct', () => {
  const out = scoreRun([{ ok: true, item: { set: 'lob', collapseMode: 'strict', id: 'a' }, classification: 'false-positive' }]);
  assert.equal(out.lob.n, 1);
  assert.equal(out.lob.rate, 1);
  assert.equal(out.buckets.lob[0].correct, true);
});

test('scores a strict lob item classified real as incorrect', () => {
  const out = scoreRun([{ ok: true, item: { set: 'lob', collapseMode: 'strict', id: 'a' }, classification: 'real' }]);
  assert.equal(out.lob.n, 1);
  assert.equal(out.lob.rate, 0);
  assert.equal(out.buckets.lob[0].correct, false);
});

test('scores a weak heldout item classified needs-human as correct', () => {
  const out = scoreRun([{ ok: true, item: { set: 'heldout', collapseMode: 'weak', id: 'b' }, classification: 'needs-human' }]);
  assert.equal(out.heldout.n, 1);
  assert.equal(out.heldout.rate, 1);
  assert.equal(out.buckets.heldout[0].correct, true);
});

test('scores a weak heldout item classified real as incorrect', () => {
  const out = scoreRun([{ ok: true, item: { set: 'heldout', collapseMode: 'weak', id: 'b' }, classification: 'real' }]);
  assert.equal(out.heldout.n, 1);
  assert.equal(out.heldout.rate, 0);
  assert.equal(out.buckets.heldout[0].correct, false);
});

test('scores a survive positive item classified real as correct and not dismissed', () => {
  const out = scoreRun([{ ok: true, item: { set: 'other', collapseMode: 'survive', id: 'c' }, classification: 'real' }]);
  assert.equal(out.positive.n, 1);
  assert.equal(out.positive.rate, 1);
  assert.deepEqual(out.positive.dismissed, []);
  assert.equal(out.buckets.positive[0].correct, true);
});

test('scores a survive positive item classified false-positive as incorrect and lists it as dismissed', () => {
  const out = scoreRun([{ ok: true, item: { set: 'other', collapseMode: 'survive', id: 'c' }, classification: 'false-positive' }]);
  assert.equal(out.positive.n, 1);
  assert.equal(out.positive.rate, 0);
  assert.deepEqual(out.positive.dismissed, ['c']);
  assert.equal(out.buckets.positive[0].correct, false);
});

test('routes an item with set other and collapseMode strict into the other bucket and scores it incorrect', () => {
  const out = scoreRun([{ ok: true, item: { set: 'other', collapseMode: 'strict', id: 'd' }, classification: 'real' }]);
  assert.equal(out.buckets.other.length, 1);
  assert.equal(out.buckets.other[0].correct, false);
  assert.equal(out.lob.n, 0);
  assert.equal(out.heldout.n, 0);
  assert.equal(out.positive.n, 0);
});

test('computes errorRate as the fraction of failed results across a mixed run', () => {
  const results = [
    { ok: false, item: { set: 'lob', collapseMode: 'strict', id: 'e1' } },
    { ok: true, item: { set: 'lob', collapseMode: 'strict', id: 'e2' }, classification: 'false-positive' },
    { ok: false, item: { set: 'heldout', collapseMode: 'weak', id: 'e3' } },
    { ok: true, item: { set: 'heldout', collapseMode: 'weak', id: 'e4' }, classification: 'needs-human' },
  ];
  const out = scoreRun(results);
  assert.equal(out.total, 4);
  assert.equal(out.errors, 2);
  assert.equal(out.errorRate, 0.5);
  assert.equal(out.lob.n, 1);
  assert.equal(out.lob.rate, 1);
  assert.equal(out.heldout.n, 1);
  assert.equal(out.heldout.rate, 1);
  assert.equal(out.positive.n, 0);
  assert.equal(out.positive.rate, null);
  assert.deepEqual(out.positive.dismissed, []);
});
