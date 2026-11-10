// Computes the ordered ids whose attribute sets contain every intent attribute (bin/lib/fca.mjs extentOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extentOf } from '../lib/fca.mjs';

test('returns an empty array when the order is empty', () => {
  const intent = ['a'];
  const objects = new Map([['x', new Set(['a'])]]);
  const order = [];
  const r = extentOf(intent, objects, order);
  assert.deepEqual(r, []);
});

test('returns the id when the object has every intent attribute', () => {
  const intent = ['a', 'b'];
  const objects = new Map([['x', new Set(['a', 'b'])]]);
  const order = ['x'];
  const r = extentOf(intent, objects, order);
  assert.deepEqual(r, ["x"]);
});

test('omits the id when the object lacks one intent attribute', () => {
  const intent = ['a', 'b'];
  const objects = new Map([['x', new Set(['a'])]]);
  const order = ['x'];
  const r = extentOf(intent, objects, order);
  assert.deepEqual(r, []);
});

test('omits the id when the object has no intent attributes at all', () => {
  const intent = ['a', 'b'];
  const objects = new Map([['x', new Set()]]);
  const order = ['x'];
  const r = extentOf(intent, objects, order);
  assert.deepEqual(r, []);
});

test('returns an empty array when the intent is empty', () => {
  const intent = [];
  const objects = new Map([['x', new Set(['a'])]]);
  const order = ['x'];
  const r = extentOf(intent, objects, order);
  assert.deepEqual(r, ["x"]);
});

test('keeps only the ids that satisfy the intent in the given order', () => {
  const intent = ['a', 'b'];
  const objects = new Map([
    ['x', new Set(['a', 'b'])],
    ['y', new Set(['a'])],
    ['z', new Set(['a', 'b', 'c'])],
  ]);
  const order = ['y', 'x', 'z'];
  const r = extentOf(intent, objects, order);
  assert.deepEqual(r, ["x", "z"]);
});

test('throws a TypeError when an id in the order has no entry in objects', () => {
  const intent = ['a'];
  const objects = new Map();
  const order = ['missing'];
  assert.throws(() => extentOf(intent, objects, order), { name: "TypeError", message: "Cannot read properties of undefined (reading 'has')" });
});

test('throws a TypeError when the intent is not iterable', () => {
  const intent = 42;
  const objects = new Map([['x', new Set(['a'])]]);
  const order = ['x'];
  assert.throws(() => extentOf(intent, objects, order), { name: "TypeError", message: "intent is not iterable" });
});
