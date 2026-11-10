// Returns current time in ms, honoring an explicit arg or CW_NOW env (monitor/retention.mjs nowMs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nowMs } from '../retention.mjs';

test('returns the argument when it is a number', () => {
  const r = nowMs(1234);
  assert.equal(r, 1234);
});

test('returns the argument when it is a string', () => {
  const r = nowMs('hello');
  assert.equal(r, "hello");
});

test('returns the argument when it is an object', () => {
  const r = nowMs({ a: 1 });
  assert.deepEqual(r, { a: 1 });
});

test('returns the argument when it is null', () => {
  const r = nowMs(null);
  assert.equal(r, null);
});

test('returns the argument when it is false', () => {
  const r = nowMs(false);
  assert.equal(r, false);
});

test('returns the argument when it is zero', () => {
  const r = nowMs(0);
  assert.equal(r, 0);
});

test('returns the argument when it is an empty string', () => {
  const r = nowMs('');
  assert.equal(r, "");
});

test('returns the argument when it is NaN', () => {
  const r = nowMs(NaN);
  assert.equal(r, NaN);
});

test('returns the argument when it is Infinity', () => {
  const r = nowMs(Infinity);
  assert.equal(r, Infinity);
});

test('returns the argument when it is -Infinity', () => {
  const r = nowMs(-Infinity);
  assert.equal(r, -Infinity);
});
