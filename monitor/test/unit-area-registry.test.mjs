// Memoised registry load (monitor/area.mjs registry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../area.mjs';

test('registry returns the same object reference on repeated calls', () => {
  const first = registry();
  const second = registry();
  assert.strictEqual(first, second);
});

test('registry returns a non-null value', () => {
  const result = registry();
  assert.notStrictEqual(result, null);
});

test('registry returns an object', () => {
  const result = registry();
  assert.strictEqual(typeof result, 'object');
});

test('registry result is not undefined', () => {
  const result = registry();
  assert.notStrictEqual(result, undefined);
});

test('registry result is not a function', () => {
  const result = registry();
  assert.notStrictEqual(typeof result, 'function');
});

test('registry result is not a string', () => {
  const result = registry();
  assert.notStrictEqual(typeof result, 'string');
});

test('registry result is not a number', () => {
  const result = registry();
  assert.notStrictEqual(typeof result, 'number');
});

test('registry result is not a boolean', () => {
  const result = registry();
  assert.notStrictEqual(typeof result, 'boolean');
});
