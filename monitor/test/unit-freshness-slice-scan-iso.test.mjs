// Converts a sweep sliceId stamp into an ISO-8601 UTC string (monitor/freshness.mjs sliceScanIso).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceScanIso } from '../freshness.mjs';

test('returns ISO string for valid 14-digit UTC stamp', () => {
  const result = sliceScanIso('sweep-20231015123045');
  assert.equal(result, '2023-10-15T12:30:45.000Z');
});

test('returns ISO string for valid stamp with area suffix', () => {
  const result = sliceScanIso('sweep-20231015123045-core');
  assert.equal(result, '2023-10-15T12:30:45.000Z');
});

test('returns null for non-string input', () => {
  assert.equal(sliceScanIso(null), null);
  assert.equal(sliceScanIso(undefined), null);
  assert.equal(sliceScanIso(12345), null);
  assert.equal(sliceScanIso({}), null);
});

test('returns null for string not matching sweep prefix', () => {
  assert.equal(sliceScanIso('scan-20231015123045'), null);
  assert.equal(sliceScanIso('sweep20231015123045'), null);
  assert.equal(sliceScanIso('Sweep-20231015123045'), null);
});

test('returns null for stamp with fewer than 14 digits', () => {
  assert.equal(sliceScanIso('sweep-2023101512304'), null);
  assert.equal(sliceScanIso('sweep-202310151230'), null);
});

test('returns null for empty string', () => {
  assert.equal(sliceScanIso(''), null);
});

test('returns null for invalid date values like month 13', () => {
  const result = sliceScanIso('sweep-20231315123045');
  assert.equal(result, null);
});

test('returns null for invalid date values like day 32', () => {
  const result = sliceScanIso('sweep-20231032123045');
  assert.equal(result, null);
});

test('returns null for invalid time values like hour 25', () => {
  const result = sliceScanIso('sweep-20231015253045');
  assert.equal(result, null);
});

test('returns null for invalid time values like minute 60', () => {
  const result = sliceScanIso('sweep-20231015126045');
  assert.equal(result, null);
});
