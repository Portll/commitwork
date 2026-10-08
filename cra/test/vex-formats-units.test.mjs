// cra/test/vex-formats-units.test.mjs — case tests for dayStartIso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayStartIso } from '../vex-formats.mjs';

test('returns ISO string with T00:00:00.000Z for valid date', () => {
  assert.equal(dayStartIso('2024-01-15'), '2024-01-15T00:00:00.000Z');
});

test('returns null for empty string', () => {
  assert.equal(dayStartIso(''), null);
});

test('returns null for undefined', () => {
  assert.equal(dayStartIso(undefined), null);
});

test('returns null for null', () => {
  assert.equal(dayStartIso(null), null);
});

test('returns null for invalid date format with time', () => {
  assert.equal(dayStartIso('2024-01-15T10:30:00Z'), null);
});

test('returns null for non-date string', () => {
  assert.equal(dayStartIso('hello'), null);
});

test('returns null for number input', () => {
  assert.equal(dayStartIso(20240115), null);
});
