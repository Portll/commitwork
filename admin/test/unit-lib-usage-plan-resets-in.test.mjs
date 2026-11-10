// Computes human-readable time remaining until a usage plan resets (admin/lib/usage-plan.mjs resetsIn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetsIn } from '../lib/usage-plan.mjs';

test('returns null when resetsAt is not a string', () => {
  assert.equal(resetsIn(12345), null);
  assert.equal(resetsIn(null), null);
  assert.equal(resetsIn(undefined), null);
  assert.equal(resetsIn({}), null);
});

test('returns null when resetsAt is not a valid date string', () => {
  assert.equal(resetsIn('not-a-date'), null);
  assert.equal(resetsIn(''), null);
  assert.equal(resetsIn('abc123'), null);
});

test('returns due now when resetsAt is in the past', () => {
  const now = 1000000;
  const past = new Date(now - 1000).toISOString();
  const result = resetsIn(past, now);
  assert.equal(result.ms, -1000);
  assert.equal(result.text, 'due now');
});

test('returns due now when resetsAt equals now', () => {
  const now = 1000000;
  const atNow = new Date(now).toISOString();
  const result = resetsIn(atNow, now);
  assert.equal(result.ms, 0);
  assert.equal(result.text, 'due now');
});

test('returns minutes text when less than 60 minutes', () => {
  const now = 0;
  const in5min = new Date(5 * 60000).toISOString();
  const result = resetsIn(in5min, now);
  assert.equal(result.ms, 300000);
  assert.equal(result.text, 'resets in 5 min');
});

test('returns minutes text at exactly 59 minutes', () => {
  const now = 0;
  const in59min = new Date(59 * 60000).toISOString();
  const result = resetsIn(in59min, now);
  assert.equal(result.ms, 59 * 60000);
  assert.equal(result.text, 'resets in 59 min');
});

test('returns hours text when 60 minutes or more but less than 24 hours', () => {
  const now = 0;
  const in2h30m = new Date((2 * 60 + 30) * 60000).toISOString();
  const result = resetsIn(in2h30m, now);
  assert.equal(result.ms, (2 * 60 + 30) * 60000);
  assert.equal(result.text, 'resets in 2h 30m');
});

test('returns hours text with no minutes when remainder is zero', () => {
  const now = 0;
  const in3h = new Date(3 * 60 * 60000).toISOString();
  const result = resetsIn(in3h, now);
  assert.equal(result.ms, 3 * 60 * 60000);
  assert.equal(result.text, 'resets in 3h');
});

test('returns days text when 24 hours or more', () => {
  const now = 0;
  const in2d = new Date(2 * 24 * 60 * 60000).toISOString();
  const result = resetsIn(in2d, now);
  assert.equal(result.ms, 2 * 24 * 60 * 60000);
  assert.equal(result.text, 'resets in 2d');
});

test('returns days text rounded when between 24 and 48 hours', () => {
  const now = 0;
  const in36h = new Date(36 * 60 * 60000).toISOString();
  const result = resetsIn(in36h, now);
  assert.equal(result.ms, 36 * 60 * 60000);
  assert.equal(result.text, 'resets in 2d');
});

test('returns hours text at exactly 60 minutes', () => {
  const now = 0;
  const in60min = new Date(60 * 60000).toISOString();
  const result = resetsIn(in60min, now);
  assert.equal(result.ms, 60 * 60000);
  assert.equal(result.text, 'resets in 1h');
});

test('returns hours text at exactly 23 hours 59 minutes', () => {
  const now = 0;
  const in23h59m = new Date((23 * 60 + 59) * 60000).toISOString();
  const result = resetsIn(in23h59m, now);
  assert.equal(result.ms, (23 * 60 + 59) * 60000);
  assert.equal(result.text, 'resets in 23h 59m');
});

test('returns days text at exactly 24 hours', () => {
  const now = 0;
  const in24h = new Date(24 * 60 * 60000).toISOString();
  const result = resetsIn(in24h, now);
  assert.equal(result.ms, 24 * 60 * 60000);
  assert.equal(result.text, 'resets in 1d');
});

test('returns due now when resetsAt is 1 millisecond in the past', () => {
  const now = 1000000;
  const past = new Date(now - 1).toISOString();
  const result = resetsIn(past, now);
  assert.equal(result.ms, -1);
  assert.equal(result.text, 'due now');
});

test('returns minutes text when resetsAt is 1 millisecond in the future', () => {
  const now = 1000000;
  const future = new Date(now + 1).toISOString();
  const result = resetsIn(future, now);
  assert.equal(result.ms, 1);
  assert.equal(result.text, 'resets in 0 min');
});
