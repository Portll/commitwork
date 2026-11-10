// Encodes a date as a DER UTCTime TLV (lib/der.mjs utcTime).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utcTime } from '../der.mjs';

test('encodes a date in 1950 as UTCTime', () => {
  const result = utcTime('1950-01-01T00:00:00Z');
  assert.deepEqual(result, Buffer.from([0x17, 0x0d, 0x35, 0x30, 0x30, 0x31, 0x30, 0x31, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x5a]));
});

test('encodes a date in 2049 as UTCTime', () => {
  const result = utcTime('2049-12-31T23:59:59Z');
  assert.deepEqual(result, Buffer.from([0x17, 0x0d, 0x34, 0x39, 0x31, 0x32, 0x33, 0x31, 0x32, 0x33, 0x35, 0x39, 0x35, 0x39, 0x5a]));
});

test('throws for a date in 1949', () => {
  assert.throws(() => utcTime('1949-12-31T23:59:59Z'), /UTCTime cannot carry year 1949/);
});

test('throws for a date in 2050', () => {
  assert.throws(() => utcTime('2050-01-01T00:00:00Z'), /UTCTime cannot carry year 2050/);
});

test('throws for an invalid date', () => {
  assert.throws(() => utcTime('not-a-date'), /UTCTime cannot carry an invalid date/);
});

test('encodes a date in 2023 with correct padding', () => {
  const result = utcTime('2023-05-09T14:03:07Z');
  assert.deepEqual(result, Buffer.from([0x17, 0x0d, 0x32, 0x33, 0x30, 0x35, 0x30, 0x39, 0x31, 0x34, 0x30, 0x33, 0x30, 0x37, 0x5a]));
});
