// Decodes a JWT payload from base64url text, returning the parsed object and matched token string, or null. (admin/routes/leaks-verify.mjs decodeJwt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeJwt } from '../routes/leaks-verify.mjs';
import { Buffer } from 'node:buffer';

test('returns null for empty string input', () => {
  const input = '';
  const result = decodeJwt(input);
  assert.deepEqual(result, null);
});

test('returns null for null input', () => {
  const input = null;
  const result = decodeJwt(input);
  assert.deepEqual(result, null);
});

test('returns null for undefined input', () => {
  const input = undefined;
  const result = decodeJwt(input);
  assert.deepEqual(result, null);
});

test('returns null when header is too short to match regex', () => {
  const input = 'eyJabc.defghij.abc';
  const result = decodeJwt(input);
  assert.deepEqual(result, null);
});

test('returns null when payload segment is too short to match regex', () => {
  const input = 'eyJabcdef.ghij.abc';
  const result = decodeJwt(input);
  assert.deepEqual(result, null);
});

test('returns null when payload is not valid JSON', () => {
  const payload = Buffer.from('not valid json', 'utf8').toString('base64url');
  const input = `eyJabcdef.${payload}.sig`;
  const result = decodeJwt(input);
  assert.deepEqual(result, null);
});

test('returns null when payload is a primitive string', () => {
  const payload = Buffer.from(JSON.stringify('hello'), 'utf8').toString('base64url');
  const input = `eyJabcdef.${payload}.sig`;
  const result = decodeJwt(input);
  assert.deepEqual(result, null);
});

test('returns null when payload is null', () => {
  const payload = Buffer.from(JSON.stringify(null), 'utf8').toString('base64url');
  const input = `eyJabcdef.${payload}.sig`;
  const result = decodeJwt(input);
  assert.deepEqual(result, null);
});

test('returns payload object and token when input is a valid JWT with object payload', () => {
  const payloadObj = { sub: 'user123', exp: 1700000000 };
  const payload = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const input = `eyJabcdef.${payload}.signature`;
  const result = decodeJwt(input);
  assert.deepEqual(result, { payload: { sub: "user123", exp: 1700000000 }, token: "eyJabcdef.eyJzdWIiOiJ1c2VyMTIzIiwiZXhwIjoxNzAwMDAwMDAwfQ.signature" });
});

test('returns payload object when base64url uses dash and underscore characters', () => {
  const payloadObj = { data: 'test-value_with_underscores' };
  const payload = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const input = `eyJabcdef.${payload}.sig`;
  const result = decodeJwt(input);
  assert.deepEqual(result, { payload: { data: "test-value_with_underscores" }, token: "eyJabcdef.eyJkYXRhIjoidGVzdC12YWx1ZV93aXRoX3VuZGVyc2NvcmVzIn0.sig" });
});
