// Maps sweep findings and positive-control state to a lane-confidence result (monitor/lane-confidence.mjs sweepResultFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepResultFor } from '../lane-confidence.mjs';

test('returns null when sweepFindings is undefined', () => {
  const r = sweepResultFor({ sweepFindings: undefined });
  assert.deepEqual(r, null);
});

test('returns null when sweepFindings is null', () => {
  const r = sweepResultFor({ sweepFindings: null });
  assert.deepEqual(r, null);
});

test('returns findings result for positive integer sweepFindings', () => {
  const r = sweepResultFor({ sweepFindings: 3 });
  assert.deepEqual(r, { result: "findings", why: "3 finding(s) this sweep" });
});

test('returns clean result for zero findings with current positive control', () => {
  const r = sweepResultFor({ sweepFindings: 0, positiveControl: 'current' });
  assert.deepEqual(r, { result: "clean", why: "zero findings under a current positive control" });
});

test('returns unmeasured result for zero findings with absent positive control', () => {
  const r = sweepResultFor({ sweepFindings: 0, positiveControl: 'absent' });
  assert.deepEqual(r, { result: "unmeasured", why: "zero findings, but the positive control is absent: the lane has not been shown to fire, so its silence is not a measurement" });
});

test('throws RangeError for negative sweepFindings', () => {
  assert.throws(() => sweepResultFor({ sweepFindings: -1 }), {
    name: 'RangeError',
    message: 'sweepFindings must be a non-negative integer, got -1'
  });
});

test('throws RangeError for non-integer sweepFindings', () => {
  assert.throws(() => sweepResultFor({ sweepFindings: 1.5 }), {
    name: 'RangeError',
    message: 'sweepFindings must be a non-negative integer, got 1.5'
  });
});

test('returns findings result for single finding', () => {
  const r = sweepResultFor({ sweepFindings: 1 });
  assert.deepEqual(r, { result: "findings", why: "1 finding(s) this sweep" });
});
