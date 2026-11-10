// Canonical JSON string of an event with prev and chain keys removed (monitor/history-chain.mjs eventBodyV2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventBodyV2 } from '../history-chain.mjs';

test('drops prev and chain keys while keeping others', () => {
  const r = eventBodyV2({ prev: 'p', chain: 'c', a: 1 });
  assert.equal(r, "{\"a\":1}");
});

test('keeps prev when chain is absent', () => {
  const r = eventBodyV2({ prev: 'p', a: 1 });
  assert.equal(r, "{\"a\":1}");
});

test('keeps chain when prev is absent', () => {
  const r = eventBodyV2({ chain: 'c', a: 1 });
  assert.equal(r, "{\"a\":1}");
});

test('drops undefined values', () => {
  const r = eventBodyV2({ a: undefined, b: 2 });
  assert.equal(r, "{\"b\":2}");
});

test('returns empty object canon for empty input', () => {
  const r = eventBodyV2({});
  assert.equal(r, "{}");
});

test('handles nested objects with sorted keys', () => {
  const r = eventBodyV2({ b: { y: 1, x: 2 }, a: 3 });
  assert.equal(r, "{\"a\":3,\"b\":{\"x\":2,\"y\":1}}");
});

test('handles arrays in order', () => {
  const r = eventBodyV2({ a: [3, 1, 2] });
  assert.equal(r, "{\"a\":[3,1,2]}");
});

test('throws for non-finite numbers', () => {
  assert.throws(() => eventBodyV2({ a: Infinity }), { name: 'TypeError', message: 'chain event holds a non-finite number (Infinity) \u2014 it would hash as null' });
});

test('throws for Date objects', () => {
  assert.throws(() => eventBodyV2({ a: new Date(0) }), { name: 'TypeError', message: 'chain event holds a Date \u2014 hash it as a string, not as an object whose fields JSON drops' });
});

test('handles boolean and null values', () => {
  const r = eventBodyV2({ a: true, b: null });
  assert.equal(r, "{\"a\":true,\"b\":null}");
});
