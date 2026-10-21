// Computes the age in days of a timestamp relative to the current time (monitor/adjudication-budget.mjs ageDays).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageDays } from '../adjudication-budget.mjs';

test('returns null when the timestamp is invalid', () => {
  const result = ageDays('not-a-date', 1000000);
  assert.equal(result, null);
});

test('returns 0 when the timestamp is in the future', () => {
  const now = 1000000;
  const futureTs = now + 1000;
  const result = ageDays(futureTs, now);
  assert.equal(result, 0);
});

test('returns 0 when the timestamp equals the current time', () => {
  const now = 1000000;
  const result = ageDays(now, now);
  assert.equal(result, 0);
});

test('returns the exact age in days for a past timestamp', () => {
  const now = 1000000;
  const oneDayAgo = now - 86400000;
  const result = ageDays(oneDayAgo, now);
  assert.equal(result, 1);
});

test('returns the fractional age in days for a recent past timestamp', () => {
  const now = 1000000;
  const halfDayAgo = now - 43200000;
  const result = ageDays(halfDayAgo, now);
  assert.equal(result, 0.5);
});

test('returns null when the timestamp is NaN', () => {
  const result = ageDays(NaN, 1000000);
  assert.equal(result, null);
});

test('returns 0 when the timestamp is slightly in the future', () => {
  const now = 1000000;
  const slightlyFuture = now + 1;
  const result = ageDays(slightlyFuture, now);
  assert.equal(result, 0);
});

test('returns the age for a timestamp exactly one day in the past', () => {
  const now = 86400000;
  const oneDayAgo = 0;
  const result = ageDays(oneDayAgo, now);
  assert.equal(result, 1);
});
