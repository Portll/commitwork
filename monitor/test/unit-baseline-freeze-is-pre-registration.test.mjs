// Determines if a freeze timestamp precedes the first measurement (monitor/baseline-freeze.mjs isPreRegistration).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPreRegistration } from '../baseline-freeze.mjs';

test('returns no freeze error when freeze is null', () => {
  const r = isPreRegistration(null, '2024-01-01T00:00:00Z');
  assert.deepEqual(r, { ok: false, why: "no freeze to check" });
});

test('returns no freeze error when freeze.at is missing', () => {
  const r = isPreRegistration({}, '2024-01-01T00:00:00Z');
  assert.deepEqual(r, { ok: false, why: "no freeze to check" });
});

test('returns unparseable error when freeze.at is invalid', () => {
  const r = isPreRegistration({ at: 'not-a-date' }, '2024-01-01T00:00:00Z');
  assert.deepEqual(r, { ok: false, why: "unparseable timestamp on one side \u2014 cannot establish order" });
});

test('returns unparseable error when firstMeasurementAt is invalid', () => {
  const r = isPreRegistration({ at: '2024-01-01T00:00:00Z' }, 'not-a-date');
  assert.deepEqual(r, { ok: false, why: "unparseable timestamp on one side \u2014 cannot establish order" });
});

test('returns ok true when freeze is before first measurement', () => {
  const r = isPreRegistration({ at: '2024-01-01T00:00:00Z' }, '2024-01-02T00:00:00Z');
  assert.deepEqual(r, { ok: true, why: "frozen 2024-01-01T00:00:00Z before first measurement 2024-01-02T00:00:00Z" });
});

test('returns ok false when freeze is after first measurement', () => {
  const r = isPreRegistration({ at: '2024-01-02T00:00:00Z' }, '2024-01-01T00:00:00Z');
  assert.deepEqual(r, { ok: false, why: "frozen 2024-01-02T00:00:00Z at or AFTER first measurement 2024-01-01T00:00:00Z \u2014 this is a post-registration" });
});

test('returns ok false when freeze equals first measurement', () => {
  const r = isPreRegistration({ at: '2024-01-01T00:00:00Z' }, '2024-01-01T00:00:00Z');
  assert.deepEqual(r, { ok: false, why: "frozen 2024-01-01T00:00:00Z at or AFTER first measurement 2024-01-01T00:00:00Z \u2014 this is a post-registration" });
});
