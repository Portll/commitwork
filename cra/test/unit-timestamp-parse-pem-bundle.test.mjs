// Parses PEM certificate blocks into X509Certificate objects (cra/timestamp.mjs parsePemBundle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePemBundle } from '../timestamp.mjs';

test('returns an empty array when the input contains no certificate blocks', () => {
  const result = parsePemBundle('hello world');
  assert.deepEqual(result, []);
});

test('returns an empty array when the input is an empty string', () => {
  const result = parsePemBundle('');
  assert.deepEqual(result, []);
});

test('returns an empty array when the input is null', () => {
  const result = parsePemBundle(null);
  assert.deepEqual(result, []);
});

test('returns an empty array when the input is undefined', () => {
  const result = parsePemBundle(undefined);
  assert.deepEqual(result, []);
});

test('returns an empty array when the input is a number', () => {
  const result = parsePemBundle(12345);
  assert.deepEqual(result, []);
});

test('returns an empty array when the input is a boolean', () => {
  const result = parsePemBundle(true);
  assert.deepEqual(result, []);
});

test('returns an empty array when the input is an object', () => {
  const result = parsePemBundle({});
  assert.deepEqual(result, []);
});

test('returns an empty array when the input is an array', () => {
  const result = parsePemBundle([]);
  assert.deepEqual(result, []);
});
