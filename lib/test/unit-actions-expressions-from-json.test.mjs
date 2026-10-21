// Parses a string as JSON and converts the result to an expression value (lib/actions-expressions.mjs fromJson).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromJson } from '../actions-expressions.mjs';

test('returns null for the string null', () => {
  assert.equal(fromJson('null'), null);
});

test('returns a number for a numeric JSON string', () => {
  assert.equal(fromJson('42'), 42);
});

test('returns a string for a quoted JSON string', () => {
  assert.equal(fromJson('"hello"'), 'hello');
});

test('returns a boolean for a boolean JSON string', () => {
  assert.equal(fromJson('true'), true);
});

test('returns an array for a JSON array', () => {
  const result = fromJson('[1, 2]');
  assert.ok(Array.isArray(result));
  assert.deepEqual(result, [1, 2]);
});

test('returns a Dict for a JSON object', () => {
  const result = fromJson('{"a": 1}');
  assert.equal(result.get('a'), 1);
});

test('throws ExpressionError for empty input', () => {
  assert.throws(() => fromJson(''), /empty input/);
});

test('throws ExpressionError for invalid JSON', () => {
  assert.throws(() => fromJson('{invalid}'), /Error parsing JSON/);
});
