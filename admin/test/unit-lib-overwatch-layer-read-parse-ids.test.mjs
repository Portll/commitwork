// Parses a raw ids column into an object or an unreadable marker (admin/lib/overwatch-layer-read.mjs parseIds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIds } from '../lib/overwatch-layer-read.mjs';

test('returns null when raw is null', () => {
  assert.equal(parseIds(null), null);
});

test('returns null when raw is undefined', () => {
  assert.equal(parseIds(undefined), null);
});

test('returns the parsed object when raw is a JSON object string', () => {
  const raw = JSON.stringify({ a: 1, b: 'two' });
  assert.deepEqual(parseIds(raw), { a: 1, b: 'two' });
});

test('returns unreadable marker when raw is a JSON array string', () => {
  const raw = JSON.stringify([1, 2, 3]);
  assert.deepEqual(parseIds(raw), { unreadable: 'ids column is not an object' });
});

test('returns unreadable marker when raw is a JSON string scalar', () => {
  const raw = JSON.stringify('hello');
  assert.deepEqual(parseIds(raw), { unreadable: 'ids column is not an object' });
});

test('returns unreadable marker when raw is a JSON number', () => {
  const raw = JSON.stringify(42);
  assert.deepEqual(parseIds(raw), { unreadable: 'ids column is not an object' });
});

test('returns unreadable marker when raw is a JSON boolean', () => {
  const raw = JSON.stringify(true);
  assert.deepEqual(parseIds(raw), { unreadable: 'ids column is not an object' });
});

test('returns unreadable marker when raw is a JSON null', () => {
  const raw = JSON.stringify(null);
  assert.deepEqual(parseIds(raw), { unreadable: 'ids column is not an object' });
});

test('returns unreadable marker when raw is invalid JSON', () => {
  const raw = '{ not valid json';
  assert.deepEqual(parseIds(raw), { unreadable: 'ids column is not valid JSON' });
});

test('returns the parsed object for a large repeated key object', () => {
  const obj = Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['k' + i, i]));
  const raw = JSON.stringify(obj);
  assert.deepEqual(parseIds(raw), obj);
});
