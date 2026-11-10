// Parses an unattended-hours range string (monitor/host-role.mjs parseUnattendedHours).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUnattendedHours } from '../host-role.mjs';

test('accepts a valid single-digit to double-digit range', () => {
  const r = parseUnattendedHours('9-17');
  assert.deepEqual(r, { from: 9, to: 17 });
});

test('accepts a valid double-digit to double-digit range', () => {
  const r = parseUnattendedHours('10-22');
  assert.deepEqual(r, { from: 10, to: 22 });
});

test('accepts a valid single-digit to single-digit range', () => {
  const r = parseUnattendedHours('8-12');
  assert.deepEqual(r, { from: 8, to: 12 });
});

test('accepts a valid range ending at 24', () => {
  const r = parseUnattendedHours('0-24');
  assert.deepEqual(r, { from: 0, to: 24 });
});

test('accepts a valid range starting at 23', () => {
  const r = parseUnattendedHours('23-24');
  assert.deepEqual(r, { from: 23, to: 24 });
});

test('returns null when the range is invalid because from equals to', () => {
  const r = parseUnattendedHours('5-5');
  assert.equal(r, null);
});

test('returns null when the range is invalid because from exceeds 23', () => {
  const r = parseUnattendedHours('24-25');
  assert.equal(r, null);
});

test('returns null when the range is invalid because to exceeds 24', () => {
  const r = parseUnattendedHours('10-25');
  assert.equal(r, null);
});

test('returns null when the input does not match the expected pattern', () => {
  const r = parseUnattendedHours('abc');
  assert.equal(r, null);
});

test('returns null when the input is null', () => {
  const r = parseUnattendedHours(null);
  assert.equal(r, null);
});
