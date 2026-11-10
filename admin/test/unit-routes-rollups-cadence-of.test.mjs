// Computes the scheduling cadence label for a list of interval objects (admin/routes/rollups.mjs cadenceOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cadenceOf } from '../routes/rollups.mjs';

test('returns none when intervals is null', () => {
  assert.deepEqual(cadenceOf(null), { kind: 'none', label: 'not scheduled' });
});

test('returns none when intervals is empty array', () => {
  assert.deepEqual(cadenceOf([]), { kind: 'none', label: 'not scheduled' });
});

test('returns daily when interval has all null fields', () => {
  const intervals = [{ Weekday: null, Day: null, Month: null }];
  assert.deepEqual(cadenceOf(intervals), { kind: 'daily', label: 'daily' });
});

test('returns daily when one interval has all null fields among others', () => {
  const intervals = [
    { Weekday: 1, Day: null, Month: null },
    { Weekday: null, Day: null, Month: null }
  ];
  assert.deepEqual(cadenceOf(intervals), { kind: 'daily', label: 'daily' });
});

test('returns weekly when all intervals have same weekday', () => {
  const intervals = [
    { Weekday: 1, Day: null, Month: null },
    { Weekday: 1, Day: null, Month: null }
  ];
  assert.deepEqual(cadenceOf(intervals), { kind: 'weekly', label: 'weekly' });
});

test('returns weekly when weekday values differ by 7', () => {
  const intervals = [
    { Weekday: 1, Day: null, Month: null },
    { Weekday: 8, Day: null, Month: null }
  ];
  assert.deepEqual(cadenceOf(intervals), { kind: 'weekly', label: 'weekly' });
});

test('returns custom when weekdays differ', () => {
  const intervals = [
    { Weekday: 1, Day: null, Month: null },
    { Weekday: 2, Day: null, Month: null }
  ];
  assert.deepEqual(cadenceOf(intervals), { kind: 'custom', label: '2 days a week' });
});

test('returns custom when some intervals have null weekday', () => {
  const intervals = [
    { Weekday: 1, Day: null, Month: null },
    { Weekday: null, Day: 1, Month: null }
  ];
  assert.deepEqual(cadenceOf(intervals), { kind: 'custom', label: '1 days a week' });
});

test('returns custom with multiple distinct weekdays', () => {
  const intervals = [
    { Weekday: 1, Day: null, Month: null },
    { Weekday: 3, Day: null, Month: null },
    { Weekday: 5, Day: null, Month: null }
  ];
  assert.deepEqual(cadenceOf(intervals), { kind: 'custom', label: '3 days a week' });
});
