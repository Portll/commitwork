// Converts a YYYY-MM-DD date string to a UTC midnight ISO timestamp, or null if invalid (cra/vex-formats.mjs dayStartIso).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayStartIso } from '../vex-formats.mjs';

test('returns null for empty string input', () => {
  const r = dayStartIso('');
  assert.equal(r, null);
});

test('returns null for undefined input', () => {
  const r = dayStartIso(undefined);
  assert.equal(r, null);
});

test('returns null for null input', () => {
  const r = dayStartIso(null);
  assert.equal(r, null);
});

test('returns null for zero input', () => {
  const r = dayStartIso(0);
  assert.equal(r, null);
});

test('returns null for five-digit year string', () => {
  const r = dayStartIso('12345-01-01');
  assert.equal(r, null);
});

test('returns null for three-digit month string', () => {
  const r = dayStartIso('2024-001-01');
  assert.equal(r, null);
});

test('returns null for three-digit day string', () => {
  const r = dayStartIso('2024-01-001');
  assert.equal(r, null);
});

test('returns ISO timestamp for valid date string', () => {
  const r = dayStartIso('2024-01-01');
  assert.equal(r, "2024-01-01T00:00:00.000Z");
});

test('returns ISO timestamp for another valid date string', () => {
  const r = dayStartIso('1999-12-31');
  assert.equal(r, "1999-12-31T00:00:00.000Z");
});

test('returns null for string with extra characters', () => {
  const r = dayStartIso('2024-01-01T00:00:00Z');
  assert.equal(r, null);
});
