// Epoch milliseconds from an explicit time argument or the environment (lib/offbox-evidence.mjs nowMs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nowMs } from '../offbox-evidence.mjs';

test('a numeric argument is returned unchanged', () => {
  assert.equal(nowMs(12345), 12345);
});

test('a zero argument is returned as zero', () => {
  assert.equal(nowMs(0), 0);
});

test('a negative numeric argument is returned unchanged', () => {
  assert.equal(nowMs(-1), -1);
});

test('a Date argument is converted to its epoch milliseconds', () => {
  assert.equal(nowMs(new Date(1767323045678)), 1767323045678);
});

test('a Date at the epoch is converted to zero', () => {
  assert.equal(nowMs(new Date(0)), 0);
});

test('an invalid Date argument is converted to NaN', () => {
  assert.equal(nowMs(new Date(NaN)), NaN);
});

test('a string argument is returned as the same string without parsing', () => {
  assert.equal(nowMs('2026-01-01T00:00:00Z'), '2026-01-01T00:00:00Z');
});

test('a null argument is returned as null because it is not undefined', () => {
  assert.equal(nowMs(null), null);
});

test('a plain object argument is returned as the same object', () => {
  const obj = { getTime: 42 };
  assert.equal(nowMs(obj), obj);
});
