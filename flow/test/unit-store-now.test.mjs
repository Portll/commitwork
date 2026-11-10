// ISO-8601 UTC timestamp from CW_NOW or the clock (flow/store.mjs now).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../store.mjs';

test('a UTC ISO string in CW_NOW is returned unchanged', () => {
  assert.equal(now({ CW_NOW: '2023-05-06T07:08:09.123Z' }), '2023-05-06T07:08:09.123Z');
});

test('a timestamp with an offset is converted to UTC', () => {
  assert.equal(now({ CW_NOW: '2024-03-10T08:00:00+02:00' }), '2024-03-10T06:00:00.000Z');
});

test('a date-only CW_NOW becomes midnight UTC with milliseconds', () => {
  assert.equal(now({ CW_NOW: '2021-07-04' }), '2021-07-04T00:00:00.000Z');
});

test('a numeric CW_NOW is read as milliseconds since the epoch', () => {
  assert.equal(now({ CW_NOW: 86400000 }), '1970-01-02T00:00:00.000Z');
});

test('a negative numeric CW_NOW lands just before the epoch', () => {
  assert.equal(now({ CW_NOW: -1 }), '1969-12-31T23:59:59.999Z');
});

test('the largest representable time is formatted with an extended year', () => {
  assert.equal(now({ CW_NOW: 8.64e15 }), '+275760-09-13T00:00:00.000Z');
});

test('one millisecond past the largest representable time throws', () => {
  assert.throws(() => now({ CW_NOW: 8.64e15 + 1 }), {
    name: 'RangeError',
    message: 'Invalid time value'
  });
});

test('an unparseable CW_NOW throws an invalid time value error', () => {
  assert.throws(() => now({ CW_NOW: 'not-a-date' }), {
    name: 'RangeError',
    message: 'Invalid time value'
  });
});

test('an empty CW_NOW falls back to a current ISO timestamp instead of throwing', () => {
  assert.match(now({ CW_NOW: '' }), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});
