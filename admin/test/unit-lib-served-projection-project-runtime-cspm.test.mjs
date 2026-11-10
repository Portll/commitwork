// Projects a raw runtime CSPM result into a sanitized served shape (admin/lib/served-projection.mjs projectRuntimeCspm).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectRuntimeCspm } from '../lib/served-projection.mjs';

test('returns null when input is null', () => {
  assert.equal(projectRuntimeCspm(null), null);
});

test('returns null when input is undefined', () => {
  assert.equal(projectRuntimeCspm(undefined), null);
});

test('returns null when input is a string', () => {
  assert.equal(projectRuntimeCspm('not-an-object'), null);
});

test('returns null when input is a number', () => {
  assert.equal(projectRuntimeCspm(42), null);
});

test('returns null when input is a boolean', () => {
  assert.equal(projectRuntimeCspm(true), null);
});

test('returns sanitized object when input is an empty array', () => {
  const result = projectRuntimeCspm([]);
  assert.deepEqual(result, { ran: false, pass: null, fail: null, reason: null });
});

test('sanitizes a fully valid runtime CSPM object', () => {
  const input = { ran: true, pass: 10, fail: 2, reason: 'ok' };
  const result = projectRuntimeCspm(input);
  assert.deepEqual(result, { ran: true, pass: 10, fail: 2, reason: 'ok' });
});

test('coerces non-boolean ran to true and non-numeric pass to null', () => {
  const input = { ran: 'yes', pass: '10', fail: 0, reason: 123 };
  const result = projectRuntimeCspm(input);
  assert.deepEqual(result, { ran: true, pass: null, fail: 0, reason: null });
});

test('truncates reason longer than 200 characters', () => {
  const longReason = 'x'.repeat(250);
  const input = { ran: false, pass: null, fail: null, reason: longReason };
  const result = projectRuntimeCspm(input);
  assert.equal(result.reason.length, 200);
  assert.equal(result.reason, 'x'.repeat(200));
});

test('keeps reason exactly 200 characters unchanged', () => {
  const exactReason = 'y'.repeat(200);
  const input = { ran: true, pass: 1, fail: 1, reason: exactReason };
  const result = projectRuntimeCspm(input);
  assert.equal(result.reason, exactReason);
});
