// Validates that an overrides object maps valid scanner ids to "on" or "off" (admin/routes/perf.mjs checkOverrides).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOverrides } from '../routes/perf.mjs';

test('returns empty array for undefined input', () => {
  assert.deepEqual(checkOverrides(undefined), []);
});

test('returns empty array for null input', () => {
  assert.deepEqual(checkOverrides(null), []);
});

test('returns error for non-object input', () => {
  const result = checkOverrides('on');
  assert.equal(result.length, 1);
  assert.match(result[0], /overrides must be an object/);
});

test('returns error for array input', () => {
  const result = checkOverrides(['on']);
  assert.equal(result.length, 1);
  assert.match(result[0], /overrides must be an object/);
});

test('returns empty array for valid on state', () => {
  assert.deepEqual(checkOverrides({ scanner1: 'on' }), []);
});

test('returns empty array for valid off state', () => {
  assert.deepEqual(checkOverrides({ scanner1: 'off' }), []);
});

test('returns error for invalid state value', () => {
  const result = checkOverrides({ scanner1: 'maybe' });
  assert.equal(result.length, 1);
  assert.match(result[0], /overrides\.scanner1 must be exactly "on" or "off"/);
});

test('returns error for invalid scanner id with uppercase', () => {
  const result = checkOverrides({ Scanner1: 'on' });
  assert.equal(result.length, 1);
  assert.match(result[0], /is not a scanner id/);
});

test('returns error for scanner id that is too long', () => {
  const longId = 'a'.repeat(65);
  const result = checkOverrides({ [longId]: 'on' });
  assert.equal(result.length, 1);
  assert.match(result[0], /is not a scanner id/);
});

test('returns empty array for scanner id at maximum length', () => {
  const maxId = 'a'.repeat(64);
  assert.deepEqual(checkOverrides({ [maxId]: 'on' }), []);
});
