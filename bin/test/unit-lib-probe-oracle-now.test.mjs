// epoch milliseconds from CW_NOW, else the current time (bin/lib/probe-oracle.mjs now).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../lib/probe-oracle.mjs';

function withNow(value) {
  const saved = process.env.CW_NOW;
  process.env.CW_NOW = value;
  try {
    return now();
  } finally {
    if (saved === undefined) delete process.env.CW_NOW;
    else process.env.CW_NOW = saved;
  }
}

test('an ISO timestamp with a Z suffix is returned as its epoch milliseconds', () => {
  assert.equal(withNow('2024-01-15T10:30:00.000Z'), 1705314600000);
});

test('an ISO timestamp with a positive offset is shifted back to UTC', () => {
  assert.equal(withNow('2024-01-15T10:30:00+02:00'), 1705307400000);
});

test('a date-only ISO string is read as UTC midnight', () => {
  assert.equal(withNow('2024-01-15'), 1705276800000);
});

test('the epoch itself parses to zero', () => {
  assert.equal(withNow('1970-01-01T00:00:00.000Z'), 0);
});

test('a timestamp one millisecond before the epoch parses to minus one', () => {
  assert.equal(withNow('1969-12-31T23:59:59.999Z'), -1);
});

test('a four-digit year is read as a date rather than as a number', () => {
  assert.equal(withNow('2024'), 1704067200000);
});

test('a long digit string that is not a date is returned as that number', () => {
  assert.equal(withNow('1700000000000'), 1700000000000);
});

test('the variable is read on every call so a later change takes effect', () => {
  assert.equal(withNow('1700000000000'), 1700000000000);
  assert.equal(withNow('1800000000000'), 1800000000000);
});
