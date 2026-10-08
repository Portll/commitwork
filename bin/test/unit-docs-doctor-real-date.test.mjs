// Validates calendar dates via UTC round-trip (bin/docs-doctor.mjs realDate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realDate } from '../docs-doctor.mjs';

test('returns true for a valid leap day', () => {
  assert.equal(realDate('2024-02-29'), true);
});

test('returns false for a non-leap year February 29', () => {
  assert.equal(realDate('2023-02-29'), false);
});

test('returns false for month 13', () => {
  assert.equal(realDate('2026-13-01'), false);
});

test('returns false for day 32 in January', () => {
  assert.equal(realDate('2026-01-32'), false);
});

test('returns false for day 31 in February', () => {
  assert.equal(realDate('2026-02-31'), false);
});

test('returns false for day 0', () => {
  assert.equal(realDate('2026-01-00'), false);
});

test('returns false for non-matching string format', () => {
  assert.equal(realDate('2026-1-1'), false);
});

test('returns true for a standard valid date', () => {
  assert.equal(realDate('2026-01-15'), true);
});
