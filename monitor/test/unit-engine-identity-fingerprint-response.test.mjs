// Computes a 32-char hex SHA-256 fingerprint of HTTP status, filtered header names, and JSON body keys (monitor/engine-identity.mjs fingerprintResponse).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintResponse } from '../engine-identity.mjs';

test('returns a 32-character hex string for valid JSON object body', () => {
  const result = fingerprintResponse(200, ['Content-Type', 'X-Request-Id'], '{"b":1,"a":2}');
  assert.equal(typeof result, 'string');
  assert.equal(result.length, 32);
  assert.match(result, /^[0-9a-f]{32}$/);
});

test('returns a 32-character hex string for a non-JSON body', () => {
  const result = fingerprintResponse(404, ['Content-Type'], 'not json');
  assert.equal(typeof result, 'string');
  assert.equal(result.length, 32);
  assert.match(result, /^[0-9a-f]{32}$/);
});

test('returns a 32-character hex string for a scalar JSON body', () => {
  const result = fingerprintResponse(200, ['Content-Type'], '42');
  assert.equal(typeof result, 'string');
  assert.equal(result.length, 32);
  assert.match(result, /^[0-9a-f]{32}$/);
});

test('returns a 32-character hex string for a null JSON body', () => {
  const result = fingerprintResponse(200, ['Content-Type'], 'null');
  assert.equal(typeof result, 'string');
  assert.equal(result.length, 32);
  assert.match(result, /^[0-9a-f]{32}$/);
});

test('filters out date header from fingerprint', () => {
  const withDate = fingerprintResponse(200, ['Date', 'Content-Type'], '{"a":1}');
  const withoutDate = fingerprintResponse(200, ['Content-Type'], '{"a":1}');
  assert.equal(withDate, withoutDate);
});

test('filters out content-length header from fingerprint', () => {
  const withLength = fingerprintResponse(200, ['Content-Length', 'Content-Type'], '{"a":1}');
  const withoutLength = fingerprintResponse(200, ['Content-Type'], '{"a":1}');
  assert.equal(withLength, withoutLength);
});

test('lowercases header names before filtering and sorting', () => {
  const mixedCase = fingerprintResponse(200, ['DATE', 'Content-Type', 'X-Api-Key'], '{"a":1}');
  const lowerCase = fingerprintResponse(200, ['date', 'content-type', 'x-api-key'], '{"a":1}');
  assert.equal(mixedCase, lowerCase);
});

test('produces different fingerprints for different status codes', () => {
  const status200 = fingerprintResponse(200, ['Content-Type'], '{"a":1}');
  const status404 = fingerprintResponse(404, ['Content-Type'], '{"a":1}');
  assert.notEqual(status200, status404);
});

test('produces different fingerprints for different header sets', () => {
  const headersA = fingerprintResponse(200, ['Content-Type'], '{"a":1}');
  const headersB = fingerprintResponse(200, ['X-Request-Id'], '{"a":1}');
  assert.notEqual(headersA, headersB);
});

test('produces different fingerprints for different JSON key sets', () => {
  const keysA = fingerprintResponse(200, ['Content-Type'], '{"a":1,"b":2}');
  const keysB = fingerprintResponse(200, ['Content-Type'], '{"a":1,"c":2}');
  assert.notEqual(keysA, keysB);
});
