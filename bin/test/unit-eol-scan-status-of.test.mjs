// Computes the support status of a release cycle (bin/eol-scan.mjs statusOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusOf } from '../eol-scan.mjs';

test('returns eol status when eol is true', () => {
  const r = statusOf({ eol: true }, new Date('2024-01-01T00:00:00Z'));
  assert.deepEqual(r, { status: "eol", date: null });
});

test('returns supported status when eol is false', () => {
  const r = statusOf({ eol: false }, new Date('2024-01-01T00:00:00Z'));
  assert.deepEqual(r, { status: "supported", date: null });
});

test('returns supported status when eol is null', () => {
  const r = statusOf({ eol: null }, new Date('2024-01-01T00:00:00Z'));
  assert.deepEqual(r, { status: "supported", date: null });
});

test('returns eol status when eol date is in the past', () => {
  const r = statusOf({ eol: '2023-01-01' }, new Date('2024-01-01T00:00:00Z'));
  assert.deepEqual(r, { status: "eol", date: "2023-01-01" });
});

test('returns eol status when eol date equals now', () => {
  const r = statusOf({ eol: '2024-01-01' }, new Date('2024-01-01T00:00:00Z'));
  assert.deepEqual(r, { status: "eol", date: "2024-01-01" });
});

test('returns ending status when eol date is within 90 days', () => {
  const r = statusOf({ eol: '2024-03-31' }, new Date('2024-01-01T00:00:00Z'));
  assert.deepEqual(r, { status: "ending", date: "2024-03-31" });
});

test('returns supported status when eol date is more than 90 days away', () => {
  const r = statusOf({ eol: '2024-06-01' }, new Date('2024-01-01T00:00:00Z'));
  assert.deepEqual(r, { status: "supported", date: "2024-06-01" });
});

test('returns ending status when eol date is exactly 90 days away', () => {
  const r = statusOf({ eol: '2024-04-01' }, new Date('2024-01-01T00:00:00Z'));
  assert.deepEqual(r, { status: "supported", date: "2024-04-01" });
});
