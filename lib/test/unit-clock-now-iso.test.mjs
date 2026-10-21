// Gives the canonical ISO timestamp from the pinned environment or the current time (lib/clock.mjs nowISO).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nowISO } from '../clock.mjs';

test('returns current ISO string when env key is missing', () => {
  const result = nowISO({});
  assert.match(result, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('returns canonical ISO string for valid pinned timestamp', () => {
  const result = nowISO({ CW_NOW: '2024-01-15T10:30:00.000Z' });
  assert.equal(result, '2024-01-15T10:30:00.000Z');
});

test('throws RangeError for unparseable pinned timestamp', () => {
  assert.throws(
    () => nowISO({ CW_NOW: 'not-a-date' }),
    (err) => {
      assert.ok(err instanceof RangeError);
      assert.match(err.message, /CW_NOW is not a parseable timestamp: "not-a-date"/);
      return true;
    }
  );
});

test('returns current ISO string when pinned value is empty string', () => {
  const result = nowISO({ CW_NOW: '' });
  assert.match(result, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('uses custom key when provided', () => {
  const result = nowISO({ MY_TIME: '2023-06-01T00:00:00.000Z' }, 'MY_TIME');
  assert.equal(result, '2023-06-01T00:00:00.000Z');
});

test('returns current time when custom key is missing', () => {
  const result = nowISO({}, 'MY_TIME');
  assert.match(result, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('normalizes non-ISO input to canonical ISO format', () => {
  const result = nowISO({ CW_NOW: '2024-01-15 10:30:00' });
  assert.match(result, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('throws RangeError for numeric string that is not a valid date', () => {
  assert.throws(
    () => nowISO({ CW_NOW: '99999999999999999999' }),
    (err) => {
      assert.ok(err instanceof RangeError);
      assert.match(err.message, /CW_NOW is not a parseable timestamp/);
      return true;
    }
  );
});
