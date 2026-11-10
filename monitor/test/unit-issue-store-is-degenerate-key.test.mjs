// Detects legacy issue keys whose discriminators are all the literal string "undefined" (monitor/issue-store.mjs isDegenerateKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDegenerateKey } from '../issue-store.mjs';

test('returns false when the key is null', () => {
  assert.equal(isDegenerateKey(null), false);
});

test('returns false when the key is an empty string', () => {
  assert.equal(isDegenerateKey(''), false);
});

test('returns false when the key does not start with sc:', () => {
  assert.equal(isDegenerateKey('repo|cat|undefined|undefined'), false);
});

test('returns false when the key has no parts after the second pipe', () => {
  assert.equal(isDegenerateKey('sc:repo|cat'), false);
});

test('returns true when every part after the second pipe is undefined', () => {
  assert.equal(isDegenerateKey('sc:repo|cat|undefined|undefined'), true);
});

test('returns false when one part after the second pipe is not undefined', () => {
  assert.equal(isDegenerateKey('sc:repo|cat|undefined|real'), false);
});

test('returns true when there is exactly one part after the second pipe and it is undefined', () => {
  assert.equal(isDegenerateKey('sc:repo|cat|undefined'), true);
});

test('returns false when the key is a number that does not start with sc:', () => {
  assert.equal(isDegenerateKey(123), false);
});
