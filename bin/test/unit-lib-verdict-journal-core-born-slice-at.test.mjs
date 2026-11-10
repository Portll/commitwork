// Converts a born-slice stamp into an ISO timestamp or null (bin/lib/verdict-journal-core.mjs bornSliceAt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bornSliceAt } from '../lib/verdict-journal-core.mjs';

test('returns null when the input is null', () => {
  assert.equal(bornSliceAt(null), null);
});

test('returns null when the input is a number', () => {
  assert.equal(bornSliceAt(12345678901234), null);
});

test('returns null when the input is an empty string', () => {
  assert.equal(bornSliceAt(''), null);
});

test('returns null when the input is a string without a 14-digit suffix', () => {
  assert.equal(bornSliceAt('abc'), null);
});

test('returns null when the 14-digit suffix is not a valid date', () => {
  assert.equal(bornSliceAt('99999999999999'), null);
});

test('returns the ISO string for a valid stamp with a prefix', () => {
  assert.equal(bornSliceAt('delta-20231015123045'), "2023-10-15T12:30:45Z");
});

test('returns the ISO string for a valid bare 14-digit stamp', () => {
  assert.equal(bornSliceAt('20231015123045'), "2023-10-15T12:30:45Z");
});

test('returns the ISO string for a valid stamp with a long prefix', () => {
  assert.equal(bornSliceAt('x'.repeat(100) + '20231015123045'), "2023-10-15T12:30:45Z");
});
