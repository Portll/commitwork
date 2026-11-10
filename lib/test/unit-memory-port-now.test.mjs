// ISO-8601 UTC timestamp from CW_NOW or the current time (lib/memory-port.mjs now).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../memory-port.mjs';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function withEnv(value, fn) {
  const saved = process.env.CW_NOW;
  if (value === undefined) delete process.env.CW_NOW;
  else process.env.CW_NOW = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.CW_NOW;
    else process.env.CW_NOW = saved;
  }
}

test('returns a 24 character UTC ISO string when CW_NOW is unset', () => {
  withEnv(undefined, () => {
    const r = now();
    assert.equal(r.length, 24);
    assert.match(r, ISO);
  });
});

test('returns a 24 character UTC ISO string when CW_NOW is an empty string', () => {
  withEnv('', () => {
    const r = now();
    assert.equal(r.length, 24);
    assert.match(r, ISO);
  });
});

test('returns the CW_NOW instant unchanged when it is already a UTC ISO string', () => {
  withEnv('2024-01-15T10:30:00.000Z', () => {
    assert.equal(now(), '2024-01-15T10:30:00.000Z');
  });
});

test('keeps the milliseconds of the CW_NOW instant', () => {
  withEnv('2024-01-15T10:30:00.123Z', () => {
    assert.equal(now(), '2024-01-15T10:30:00.123Z');
  });
});

test('converts a CW_NOW value with a positive offset to UTC', () => {
  withEnv('2024-06-01T12:00:00+05:30', () => {
    assert.equal(now(), '2024-06-01T06:30:00.000Z');
  });
});

test('converts a CW_NOW value with a negative offset to UTC', () => {
  withEnv('2024-01-01T00:30:00-01:00', () => {
    assert.equal(now(), '2024-01-01T01:30:00.000Z');
  });
});

test('rolls back to the previous leap day when the offset crosses midnight', () => {
  withEnv('2024-03-01T02:00:00+03:00', () => {
    assert.equal(now(), '2024-02-29T23:00:00.000Z');
  });
});

test('treats a date-only CW_NOW as midnight UTC', () => {
  withEnv('2024-02-29', () => {
    assert.equal(now(), '2024-02-29T00:00:00.000Z');
  });
});

test('throws when CW_NOW is a non-date word', () => {
  withEnv('not-a-date', () => {
    assert.throws(() => now(), { name: 'Error', message: 'CW_NOW is not a parseable date: not-a-date' });
  });
});
