// Formats an HTTP status and optional JSON body into a short refusal string (lib/memory-layer-client.mjs serverRefusal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverRefusal } from '../memory-layer-client.mjs';

test('returns base when body is null', () => {
  const result = serverRefusal(403, null);
  assert.equal(result, "HTTP 403");
});

test('returns base when body is undefined', () => {
  const result = serverRefusal(500, undefined);
  assert.equal(result, "HTTP 500");
});

test('returns base when body is empty string', () => {
  const result = serverRefusal(404, '');
  assert.equal(result, "HTTP 404");
});

test('returns base when body is non-empty string that is not valid JSON', () => {
  const result = serverRefusal(400, 'bad request');
  assert.equal(result, "HTTP 400 bad request");
});

test('returns base when body is a number', () => {
  const result = serverRefusal(403, 42);
  assert.equal(result, "HTTP 403");
});

test('returns base when body is a boolean', () => {
  const result = serverRefusal(403, true);
  assert.equal(result, "HTTP 403");
});

test('returns base when body is an object without code or message', () => {
  const result = serverRefusal(403, { foo: 'bar' });
  assert.equal(result, "HTTP 403");
});

test('returns base when body is a string that parses to a non-object', () => {
  const result = serverRefusal(403, '42');
  assert.equal(result, "HTTP 403");
});

test('returns base when body is a string that parses to null', () => {
  const result = serverRefusal(403, 'null');
  assert.equal(result, "HTTP 403");
});

test('returns base when body is a string that parses to an object with non-string code and message', () => {
  const result = serverRefusal(403, JSON.stringify({ code: 123, message: 456 }));
  assert.equal(result, "HTTP 403");
});
