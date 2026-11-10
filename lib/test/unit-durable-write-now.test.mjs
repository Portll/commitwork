// ISO timestamp from CW_NOW, or the current time when CW_NOW is unset (lib/durable-write.mjs now).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../durable-write.mjs';

test('returns an ISO string that round-trips through CW_NOW when CW_NOW is unset', () => {
  const r = now({});
  assert.equal(now({ CW_NOW: r }), r);
});

test('returns an ISO string that round-trips through CW_NOW when CW_NOW is an empty string', () => {
  const r = now({ CW_NOW: '' });
  assert.equal(now({ CW_NOW: r }), r);
});

test('returns the CW_NOW instant unchanged when it is already a UTC ISO string', () => {
  assert.equal(now({ CW_NOW: '2024-01-15T10:30:00.000Z' }), '2024-01-15T10:30:00.000Z');
});

test('keeps the milliseconds of a CW_NOW value', () => {
  assert.equal(now({ CW_NOW: '2023-06-01T00:00:00.123Z' }), '2023-06-01T00:00:00.123Z');
});

test('converts a CW_NOW value with a timezone offset to UTC', () => {
  assert.equal(now({ CW_NOW: '2024-01-15T10:30:00+02:00' }), '2024-01-15T08:30:00.000Z');
});

test('treats a date-only CW_NOW value as UTC midnight', () => {
  assert.equal(now({ CW_NOW: '2024-01-15' }), '2024-01-15T00:00:00.000Z');
});

test('returns the Unix epoch when CW_NOW is the epoch', () => {
  assert.equal(now({ CW_NOW: '1970-01-01T00:00:00.000Z' }), '1970-01-01T00:00:00.000Z');
});

test('throws when CW_NOW is not a parseable date', () => {
  assert.throws(() => now({ CW_NOW: 'not-a-date' }), {
    name: 'Error',
    message: 'CW_NOW is not a parseable date: not-a-date'
  });
});

test('throws with the whole value in the message when CW_NOW is a long unparseable string', () => {
  const bad = 'x'.repeat(50);
  assert.throws(() => now({ CW_NOW: bad }), {
    name: 'Error',
    message: `CW_NOW is not a parseable date: ${bad}`
  });
});
