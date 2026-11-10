// Adds calendar months to an ISO date, clamping the day to the target month's last day (cra/lib.mjs addMonths).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths } from '../lib.mjs';

test('adds one month to a mid-month date without clamping', () => {
  assert.equal(addMonths('2024-01-15T00:00:00.000Z', 1), "2024-02-15T00:00:00.000Z");
});

test('clamps day 31 to 28 when adding one month in a non-leap year', () => {
  assert.equal(addMonths('2023-01-31T00:00:00.000Z', 1), "2023-02-28T00:00:00.000Z");
});

test('clamps day 31 to 29 when adding one month in a leap year', () => {
  assert.equal(addMonths('2024-01-31T00:00:00.000Z', 1), "2024-02-29T00:00:00.000Z");
});

test('clamps day 30 to 28 when adding one month in a non-leap year', () => {
  assert.equal(addMonths('2023-01-30T00:00:00.000Z', 1), "2023-02-28T00:00:00.000Z");
});

test('clamps day 30 to 29 when adding one month in a leap year', () => {
  assert.equal(addMonths('2024-01-30T00:00:00.000Z', 1), "2024-02-29T00:00:00.000Z");
});

test('clamps day 31 to 30 when adding one month to a 31-day month', () => {
  assert.equal(addMonths('2024-03-31T00:00:00.000Z', 1), "2024-04-30T00:00:00.000Z");
});

test('clamps day 31 to 31 when adding one month to a 31-day month', () => {
  assert.equal(addMonths('2024-05-31T00:00:00.000Z', 1), "2024-06-30T00:00:00.000Z");
});

test('subtracts one month with day clamping', () => {
  assert.equal(addMonths('2024-03-31T00:00:00.000Z', -1), "2024-02-29T00:00:00.000Z");
});

test('adds twelve months across a year boundary', () => {
  assert.equal(addMonths('2023-12-31T00:00:00.000Z', 12), "2024-12-31T00:00:00.000Z");
});

test('adds zero months returns the same date', () => {
  assert.equal(addMonths('2024-02-29T00:00:00.000Z', 0), "2024-02-29T00:00:00.000Z");
});
