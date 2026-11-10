// Filters and sorts index rows whose generated timestamp is within the window (monitor/posture.mjs slicesInWindow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slicesInWindow } from '../posture.mjs';

test('returns empty array when indexRows is not an array', () => {
  assert.deepEqual(slicesInWindow(null, 1000000), []);
});

test('returns empty array when indexRows is undefined', () => {
  assert.deepEqual(slicesInWindow(undefined, 1000000), []);
});

test('returns empty array when indexRows is an empty array', () => {
  assert.deepEqual(slicesInWindow([], 1000000), []);
});

test('includes row when generated timestamp equals window floor', () => {
  const now = 1000000;
  const floor = now - 7 * 86400000;
  const row = { id: 'a', generated: new Date(floor).toISOString() };
  assert.deepEqual(slicesInWindow([row], now), [{ id: "a", generated: "1969-12-25T00:16:40.000Z", _t: -603800000 }]);
});

test('excludes row when generated timestamp is one millisecond before window floor', () => {
  const now = 1000000;
  const floor = now - 7 * 86400000;
  const row = { id: 'b', generated: new Date(floor - 1).toISOString() };
  assert.deepEqual(slicesInWindow([row], now), []);
});

test('excludes row when generated is null', () => {
  const row = { id: 'c', generated: null };
  assert.deepEqual(slicesInWindow([row], 1000000), []);
});

test('excludes row when generated is undefined', () => {
  const row = { id: 'd' };
  assert.deepEqual(slicesInWindow([row], 1000000), []);
});

test('excludes row when generated is an empty string', () => {
  const row = { id: 'e', generated: '' };
  assert.deepEqual(slicesInWindow([row], 1000000), []);
});

test('excludes row when generated is an invalid date string', () => {
  const row = { id: 'f', generated: 'not-a-date' };
  assert.deepEqual(slicesInWindow([row], 1000000), []);
});

test('sorts multiple valid rows by timestamp descending', () => {
  const now = 1000000;
  const rows = [
    { id: 'x', generated: new Date(now - 3000).toISOString() },
    { id: 'y', generated: new Date(now - 1000).toISOString() },
    { id: 'z', generated: new Date(now - 2000).toISOString() }
  ];
  assert.deepEqual(slicesInWindow(rows, now), [{ id: "y", generated: "1970-01-01T00:16:39.000Z", _t: 999000 }, { id: "z", generated: "1970-01-01T00:16:38.000Z", _t: 998000 }, { id: "x", generated: "1970-01-01T00:16:37.000Z", _t: 997000 }]);
});
