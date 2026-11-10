// Computes the next fire time for a set of interval specs (admin/routes/rollups.mjs nextFire).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextFire } from '../routes/rollups.mjs';

test('returns null when intervals is null', () => {
  const fromMs = new Date(2024, 0, 1, 12, 0).getTime();
  assert.equal(nextFire(null, fromMs), null);
});

test('returns null when intervals is empty array', () => {
  const fromMs = new Date(2024, 0, 1, 12, 0).getTime();
  assert.equal(nextFire([], fromMs), null);
});

test('returns next minute when no fields specified', () => {
  const fromMs = new Date(2024, 0, 1, 12, 0).getTime();
  const result = nextFire([{}], fromMs);
  assert.equal(result, new Date(2024, 0, 1, 12, 1).getTime());
});

test('returns specified hour and minute on same day', () => {
  const fromMs = new Date(2024, 0, 1, 10, 0).getTime();
  const result = nextFire([{ Hour: 14, Minute: 30 }], fromMs);
  assert.equal(result, new Date(2024, 0, 1, 14, 30).getTime());
});

test('returns next day when specified time has passed', () => {
  const fromMs = new Date(2024, 0, 1, 15, 0).getTime();
  const result = nextFire([{ Hour: 14, Minute: 30 }], fromMs);
  assert.equal(result, new Date(2024, 0, 2, 14, 30).getTime());
});

test('respects Month filter', () => {
  const fromMs = new Date(2024, 0, 1, 12, 0).getTime();
  const result = nextFire([{ Month: 2, Hour: 10, Minute: 0 }], fromMs);
  assert.equal(result, new Date(2024, 1, 1, 10, 0).getTime());
});

test('respects Day filter', () => {
  const fromMs = new Date(2024, 0, 1, 12, 0).getTime();
  const result = nextFire([{ Day: 15, Hour: 10, Minute: 0 }], fromMs);
  assert.equal(result, new Date(2024, 0, 15, 10, 0).getTime());
});

test('respects Weekday filter', () => {
  const fromMs = new Date(2024, 0, 1, 12, 0).getTime();
  const result = nextFire([{ Weekday: 1, Hour: 10, Minute: 0 }], fromMs);
  assert.equal(result, new Date(2024, 0, 8, 10, 0).getTime());
});

test('returns earliest among multiple intervals', () => {
  const fromMs = new Date(2024, 0, 1, 12, 0).getTime();
  const result = nextFire([{ Hour: 18, Minute: 0 }, { Hour: 14, Minute: 0 }], fromMs);
  assert.equal(result, new Date(2024, 0, 1, 14, 0).getTime());
});

test('returns null when no fire time found within 400 days', () => {
  const fromMs = new Date(2024, 0, 1, 12, 0).getTime();
  const result = nextFire([{ Month: 13, Hour: 10, Minute: 0 }], fromMs);
  assert.equal(result, null);
});
