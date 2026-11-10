// Hours elapsed between two ISO timestamps (cra/lib.mjs hoursSince).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoursSince } from '../lib.mjs';

test('computes positive hours when reference is after the timestamp', () => {
  const r = hoursSince('2024-01-01T00:00:00.000Z', '2024-01-01T01:00:00.000Z');
  assert.equal(r, 1);
});

test('computes zero hours when both timestamps are identical', () => {
  const r = hoursSince('2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
  assert.equal(r, 0);
});

test('computes negative hours when reference is before the timestamp', () => {
  const r = hoursSince('2024-01-01T01:00:00.000Z', '2024-01-01T00:00:00.000Z');
  assert.equal(r, -1);
});

test('computes fractional hours for sub-hour differences', () => {
  const r = hoursSince('2024-01-01T00:00:00.000Z', '2024-01-01T00:30:00.000Z');
  assert.equal(r, 0.5);
});

test('computes hours across a day boundary', () => {
  const r = hoursSince('2024-01-01T23:00:00.000Z', '2024-01-02T01:00:00.000Z');
  assert.equal(r, 2);
});

test('computes hours for a multi-day span', () => {
  const r = hoursSince('2024-01-01T00:00:00.000Z', '2024-01-03T00:00:00.000Z');
  assert.equal(r, 48);
});

test('returns NaN when the timestamp argument is not a valid date', () => {
  const r = hoursSince('not-a-date', '2024-01-01T00:00:00.000Z');
  assert.equal(r, NaN);
});

test('returns NaN when the reference argument is not a valid date', () => {
  const r = hoursSince('2024-01-01T00:00:00.000Z', 'not-a-date');
  assert.equal(r, NaN);
});
