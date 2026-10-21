// Renders a lock hold age in seconds, or 'age unknown' when the age is missing (monitor/lockfile.mjs describeAge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeAge } from '../lockfile.mjs';

test('returns age unknown when the input is null', () => {
  assert.equal(describeAge(null), 'age unknown');
});

test('returns age unknown when the input is undefined', () => {
  assert.equal(describeAge(undefined), 'age unknown');
});

test('returns 0s old when the input is zero', () => {
  assert.equal(describeAge(0), '0s old');
});

test('returns 0s old when the input is 499', () => {
  assert.equal(describeAge(499), '0s old');
});

test('returns 1s old when the input is 500', () => {
  assert.equal(describeAge(500), '1s old');
});

test('returns 1s old when the input is 1499', () => {
  assert.equal(describeAge(1499), '1s old');
});

test('returns 2s old when the input is 1500', () => {
  assert.equal(describeAge(1500), '2s old');
});

test('returns 3s old when the input is 2999', () => {
  assert.equal(describeAge(2999), '3s old');
});

test('returns 3s old when the input is 3000', () => {
  assert.equal(describeAge(3000), '3s old');
});

test('returns 4s old when the input is 3500', () => {
  assert.equal(describeAge(3500), '4s old');
});
