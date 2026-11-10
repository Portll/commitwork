// Adds days to an ISO timestamp (cra/lib.mjs addDays).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../lib.mjs';

test('adds one day to a valid ISO timestamp', () => {
  const r = addDays('2024-01-01T00:00:00.000Z', 1);
  assert.equal(r, "2024-01-02T00:00:00.000Z");
});

test('adds zero days returns the same timestamp', () => {
  const r = addDays('2024-06-15T12:30:45.123Z', 0);
  assert.equal(r, "2024-06-15T12:30:45.123Z");
});

test('adds negative days subtracts time', () => {
  const r = addDays('2024-01-01T00:00:00.000Z', -1);
  assert.equal(r, "2023-12-31T00:00:00.000Z");
});

test('adds multiple days correctly', () => {
  const r = addDays('2024-03-01T08:00:00.000Z', 3);
  assert.equal(r, "2024-03-04T08:00:00.000Z");
});

test('adds fractional days', () => {
  const r = addDays('2024-01-01T00:00:00.000Z', 0.5);
  assert.equal(r, "2024-01-01T12:00:00.000Z");
});

test('throws TypeError for invalid ISO string', () => {
  assert.throws(() => addDays('not-a-date', 1), { name: "RangeError", message: "Invalid time value" });
});

test('throws TypeError for empty string input', () => {
  assert.throws(() => addDays('', 5), { name: "RangeError", message: "Invalid time value" });
});

test('handles large day count', () => {
  const r = addDays('2024-01-01T00:00:00.000Z', 365);
  assert.equal(r, "2024-12-31T00:00:00.000Z");
});
