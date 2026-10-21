// Renders a value tree as a pretty-printed JSON-like string (lib/actions-expressions.mjs toJson).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toJson, Dict } from '../actions-expressions.mjs';

test('returns null for null input', () => {
  assert.equal(toJson(null), 'null');
});

test('returns null for undefined input', () => {
  assert.equal(toJson(undefined), 'null');
});

test('returns null for non-finite numbers', () => {
  assert.equal(toJson(Infinity), 'null');
  assert.equal(toJson(-Infinity), 'null');
  assert.equal(toJson(NaN), 'null');
});

test('returns stringified finite numbers', () => {
  assert.equal(toJson(42), '42');
  assert.equal(toJson(3.14), '3.14');
  assert.equal(toJson(0), '0');
  assert.equal(toJson(-1.5), '-1.5');
});

test('returns stringified booleans', () => {
  assert.equal(toJson(true), 'true');
  assert.equal(toJson(false), 'false');
});

test('returns stringified strings with JSON escaping', () => {
  assert.equal(toJson('hello'), '"hello"');
  assert.equal(toJson('say "hi"'), '"say \\"hi\\""');
  assert.equal(toJson(''), '""');
});

test('returns empty array literal for empty arrays', () => {
  assert.equal(toJson([]), '[]');
});

test('returns formatted array with nested values', () => {
  const result = toJson([1, 'two', true]);
  assert.equal(result, '[\n  1,\n  "two",\n  true\n]');
});

test('returns empty object literal for empty Dict', () => {
  const d = new Dict();
  assert.equal(toJson(d), '{}');
});

test('returns formatted Dict with key-value pairs', () => {
  const d = new Dict().add('name', 'test').add('count', 5);
  const result = toJson(d);
  assert.equal(result, '{\n  "name": "test",\n  "count": 5\n}');
});
