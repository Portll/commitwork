// Converts a lane staleness sample to epoch milliseconds or null (bin/lane-staleness-core.mjs sampleMs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleMs } from '../lane-staleness-core.mjs';

test('returns null for null input', () => {
  const r = sampleMs(null);
  assert.equal(r, null);
});

test('returns null for undefined input', () => {
  const r = sampleMs(undefined);
  assert.equal(r, null);
});

test('returns the number when input is a finite number', () => {
  const r = sampleMs(12345);
  assert.equal(r, 12345);
});

test('returns null when input is NaN', () => {
  const r = sampleMs(NaN);
  assert.equal(r, null);
});

test('returns null when input is Infinity', () => {
  const r = sampleMs(Infinity);
  assert.equal(r, null);
});

test('returns the at property when input is an object with a finite number at', () => {
  const r = sampleMs({ at: 99999 });
  assert.equal(r, 99999);
});

test('returns null when input is an object with a non-number at', () => {
  const r = sampleMs({ at: 'not-a-number' });
  assert.equal(r, null);
});

test('returns parsed epoch when input is a valid date string', () => {
  const r = sampleMs('2023-01-15T10:30:00Z');
  assert.equal(r, 1673778600000);
});

test('returns null when input is a whitespace-only string', () => {
  const r = sampleMs('   ');
  assert.equal(r, null);
});

test('returns null when input is an unparseable date string', () => {
  const r = sampleMs('not-a-date');
  assert.equal(r, null);
});
