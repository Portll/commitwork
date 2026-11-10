// whether a reference timestamp is past a due timestamp (cra/lib.mjs isOverdue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOverdue } from '../lib.mjs';

test('returns true when refIso is strictly after dueIso', () => {
  const r = isOverdue('2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.001Z');
  assert.equal(r, true);
});

test('returns false when refIso is strictly before dueIso', () => {
  const r = isOverdue('2024-01-01T00:00:00.001Z', '2024-01-01T00:00:00.000Z');
  assert.equal(r, false);
});

test('returns false when refIso equals dueIso', () => {
  const r = isOverdue('2024-06-15T12:30:45.123Z', '2024-06-15T12:30:45.123Z');
  assert.equal(r, false);
});

test('returns true when refIso is one millisecond after dueIso', () => {
  const r = isOverdue('2023-12-31T23:59:59.999Z', '2024-01-01T00:00:00.000Z');
  assert.equal(r, true);
});

test('returns false when refIso is one millisecond before dueIso', () => {
  const r = isOverdue('2024-01-01T00:00:00.000Z', '2023-12-31T23:59:59.999Z');
  assert.equal(r, false);
});

test('returns true for large positive time difference', () => {
  const r = isOverdue('2000-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
  assert.equal(r, true);
});

test('returns false for large negative time difference', () => {
  const r = isOverdue('2025-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z');
  assert.equal(r, false);
});
