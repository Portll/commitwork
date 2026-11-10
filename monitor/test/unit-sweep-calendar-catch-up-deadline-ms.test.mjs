// Computes the deadline for catching up a late sweep slot (monitor/sweep-calendar.mjs catchUpDeadlineMs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catchUpDeadlineMs } from '../sweep-calendar.mjs';

test('returns floorMs when late is null', () => {
  const r = catchUpDeadlineMs(null, { now: 1000, floorMs: 5000, marginMs: 1000 });
  assert.equal(r, 5000);
});

test('returns floorMs when late has no catchUp property', () => {
  const r = catchUpDeadlineMs({}, { now: 1000, floorMs: 5000, marginMs: 1000 });
  assert.equal(r, 5000);
});

test('returns floorMs when catchUp is false', () => {
  const r = catchUpDeadlineMs({ catchUp: false }, { now: 1000, floorMs: 5000, marginMs: 1000 });
  assert.equal(r, 5000);
});

test('returns floorMs when computed value is below floor', () => {
  const r = catchUpDeadlineMs({ catchUp: true, nextStartMs: 2000 }, { now: 1000, floorMs: 5000, marginMs: 1000 });
  assert.equal(r, 5000);
});

test('returns computed value when between floor and day cap', () => {
  const r = catchUpDeadlineMs({ catchUp: true, nextStartMs: 100000 }, { now: 1000, floorMs: 5000, marginMs: 1000 });
  assert.equal(r, 98000);
});

test('returns day cap when computed value exceeds day', () => {
  const r = catchUpDeadlineMs({ catchUp: true, nextStartMs: 100000000 }, { now: 1000, floorMs: 5000, marginMs: 1000 });
  assert.equal(r, 86400000);
});

test('returns floorMs when late is undefined', () => {
  const r = catchUpDeadlineMs(undefined, { now: 1000, floorMs: 5000, marginMs: 1000 });
  assert.equal(r, 5000);
});

test('returns floorMs when catchUp is 0', () => {
  const r = catchUpDeadlineMs({ catchUp: 0 }, { now: 1000, floorMs: 5000, marginMs: 1000 });
  assert.equal(r, 5000);
});
