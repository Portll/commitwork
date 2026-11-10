// Adds h hours to an ISO timestamp (cra/lib.mjs addHours).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addHours } from '../lib.mjs';

test('adds zero hours to a valid ISO timestamp', () => {
  const r = addHours('2024-01-01T00:00:00.000Z', 0);
  assert.equal(r, "2024-01-01T00:00:00.000Z");
});

test('adds one hour to a valid ISO timestamp', () => {
  const r = addHours('2024-01-01T00:00:00.000Z', 1);
  assert.equal(r, "2024-01-01T01:00:00.000Z");
});

test('adds twenty-four hours to a valid ISO timestamp', () => {
  const r = addHours('2024-01-01T00:00:00.000Z', 24);
  assert.equal(r, "2024-01-02T00:00:00.000Z");
});

test('adds a negative number of hours to a valid ISO timestamp', () => {
  const r = addHours('2024-01-01T00:00:00.000Z', -1);
  assert.equal(r, "2023-12-31T23:00:00.000Z");
});

test('adds a fractional number of hours to a valid ISO timestamp', () => {
  const r = addHours('2024-01-01T00:00:00.000Z', 0.5);
  assert.equal(r, "2024-01-01T00:30:00.000Z");
});

test('throws a TypeError when the input is not a valid date string', () => {
  assert.throws(() => addHours('not-a-date', 1), { name: "RangeError", message: "Invalid time value" });
});

test('throws a TypeError when the input is an empty string', () => {
  assert.throws(() => addHours('', 1), { name: "RangeError", message: "Invalid time value" });
});

test('adds hours across a month boundary', () => {
  const r = addHours('2024-01-31T23:00:00.000Z', 2);
  assert.equal(r, "2024-02-01T01:00:00.000Z");
});
