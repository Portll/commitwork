// Parses a "pid.startMs" token into an object or null (monitor/containers.mjs parseOwner).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOwner } from '../containers.mjs';

test('returns object for valid pid and startMs token', () => {
  assert.deepEqual(parseOwner('123.456'), { pid: 123, startMs: 456 });
});

test('returns null for non-matching string', () => {
  assert.equal(parseOwner('abc'), null);
});

test('returns null for undefined input', () => {
  assert.equal(parseOwner(undefined), null);
});

test('returns null for null input', () => {
  assert.equal(parseOwner(null), null);
});

test('returns null for zero pid', () => {
  assert.equal(parseOwner('0.123'), null);
});

test('returns null for negative pid', () => {
  assert.equal(parseOwner('-1.123'), null);
});

test('returns null for empty string', () => {
  assert.equal(parseOwner(''), null);
});

test('returns null for pid with leading zero', () => {
  assert.equal(parseOwner('01.123'), null);
});

test('returns null for non-numeric startMs', () => {
  assert.equal(parseOwner('123.abc'), null);
});

test('returns null for extra dot in token', () => {
  assert.equal(parseOwner('123.456.789'), null);
});
