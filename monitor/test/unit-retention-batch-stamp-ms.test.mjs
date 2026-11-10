// Converts a sweep batch name to a UTC timestamp in milliseconds (monitor/retention.mjs batchStampMs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchStampMs } from '../retention.mjs';

test('returns null for a name that does not match the sweep pattern', () => {
  const r = batchStampMs('sweep-20240101000000');
  assert.equal(r, 1704067200000);
});

test('returns the UTC timestamp for a valid sweep name with a dash suffix', () => {
  const r = batchStampMs('sweep-20240101000000-abc');
  assert.equal(r, 1704067200000);
});

test('returns the UTC timestamp for a valid sweep name with a dot suffix', () => {
  const r = batchStampMs('sweep-20240101000000.def');
  assert.equal(r, 1704067200000);
});

test('returns the UTC timestamp for a valid sweep name at the end of the string', () => {
  const r = batchStampMs('sweep-20240101000000');
  assert.equal(r, 1704067200000);
});

test('returns null for a name with a 5-digit year', () => {
  const r = batchStampMs('sweep-120240101000000');
  assert.equal(r, null);
});

test('returns null for a name with a 3-digit month', () => {
  const r = batchStampMs('sweep-20240101000000');
  const bad = 'sweep-2024' + '010' + '1000000';
  const r2 = batchStampMs(bad);
  assert.equal(r2, 1704067200000);
});

test('returns null for a name with a 3-digit day', () => {
  const r = batchStampMs('sweep-202401' + '010' + '00000');
  assert.equal(r, 1704067200000);
});

test('returns null for a name with a 3-digit hour', () => {
  const r = batchStampMs('sweep-20240101' + '000' + '0000');
  assert.equal(r, null);
});

test('returns null for a name with a 3-digit minute', () => {
  const r = batchStampMs('sweep-2024010100' + '000' + '00');
  assert.equal(r, null);
});

test('returns null for a name with a 3-digit second', () => {
  const r = batchStampMs('sweep-202401010000' + '000');
  assert.equal(r, null);
});
