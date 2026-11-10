// Checks whether a record carries credential-bearing keys or content (lib/memory-layer-client.mjs redactionCheck).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactionCheck } from '../memory-layer-client.mjs';

test('returns ok true when record has no denied keys and content is a non-empty string', () => {
  const r = redactionCheck({ content: 'hello world' });
  assert.deepEqual(r, { ok: true, reasons: [] });
});

test('returns ok false when record has a denied key and content is a non-empty string', () => {
  const r = redactionCheck({ token: 'abc', content: 'hello world' });
  assert.deepEqual(r, { ok: false, reasons: ["record carries a credential-bearing key: token"] });
});

test('returns ok false when content is absent', () => {
  const r = redactionCheck({});
  assert.deepEqual(r, { ok: false, reasons: ["content is absent or not a string \u2014 an empty write is not a legitimate write"] });
});

test('returns ok false when content is an empty string', () => {
  const r = redactionCheck({ content: '' });
  assert.deepEqual(r, { ok: false, reasons: ["content is absent or not a string \u2014 an empty write is not a legitimate write"] });
});

test('returns ok false when content is a single character string', () => {
  const r = redactionCheck({ content: 'a' });
  assert.deepEqual(r, { ok: true, reasons: [] });
});

test('returns ok false when content is a single character string with a denied key', () => {
  const r = redactionCheck({ token: 'abc', content: 'a' });
  assert.deepEqual(r, { ok: false, reasons: ["record carries a credential-bearing key: token"] });
});

test('returns ok false when content embeds a credential-bearing field', () => {
  const r = redactionCheck({ content: 'token: abc123' });
  assert.deepEqual(r, { ok: false, reasons: ["content embeds a credential-bearing field: token"] });
});

test('returns ok false when record is null', () => {
  const r = redactionCheck(null);
  assert.deepEqual(r, { ok: false, reasons: ["content is absent or not a string \u2014 an empty write is not a legitimate write"] });
});

test('returns ok false when content is a number', () => {
  const r = redactionCheck({ content: 42 });
  assert.deepEqual(r, { ok: false, reasons: ["content is absent or not a string \u2014 an empty write is not a legitimate write"] });
});

test('returns ok false when content is a boolean', () => {
  const r = redactionCheck({ content: true });
  assert.deepEqual(r, { ok: false, reasons: ["content is absent or not a string \u2014 an empty write is not a legitimate write"] });
});
