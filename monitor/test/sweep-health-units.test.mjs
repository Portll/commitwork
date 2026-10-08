// monitor/test/sweep-health-units.test.mjs — case tests for pidErrorMeans.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pidErrorMeans } from '../sweep-health.mjs';

test('returns false for ESRCH', () => {
  assert.equal(pidErrorMeans('ESRCH'), false);
});

test('returns true for EPERM', () => {
  assert.equal(pidErrorMeans('EPERM'), true);
});

test('returns null for other error codes', () => {
  assert.equal(pidErrorMeans('EACCES'), null);
});

test('returns null for undefined', () => {
  assert.equal(pidErrorMeans(undefined), null);
});

test('returns null for null', () => {
  assert.equal(pidErrorMeans(null), null);
});

test('returns null for empty string', () => {
  assert.equal(pidErrorMeans(''), null);
});
