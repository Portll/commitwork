// Converts plain JS values into expression values (lib/actions-expressions.mjs toValue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toValue, Dict, Filtered } from '../actions-expressions.mjs';

test('returns null for undefined input', () => {
  assert.strictEqual(toValue(undefined), null);
});

test('returns null for null input', () => {
  assert.strictEqual(toValue(null), null);
});

test('returns the same Dict instance when input is a Dict', () => {
  const d = new Dict();
  d.add('key', 'value');
  const result = toValue(d);
  assert.strictEqual(result, d);
});

test('returns the same Filtered instance when input is a Filtered', () => {
  const f = new Filtered();
  f.push(1, 2, 3);
  const result = toValue(f);
  assert.strictEqual(result, f);
});

test('maps each element of a plain array through toValue', () => {
  const input = [1, 'two', true, null, undefined];
  const result = toValue(input);
  assert.deepStrictEqual(result, [1, 'two', true, null, null]);
});

test('converts a plain object into a Dict looked up case-insensitively', () => {
  const input = { Name: 'Alice', Age: 30, Active: true };
  const result = toValue(input);
  assert.ok(result instanceof Object);
  assert.deepStrictEqual(result.pairs(), [['Name', 'Alice'], ['Age', 30], ['Active', true]]);
  assert.strictEqual(result.get('name'), 'Alice');
  assert.strictEqual(result.get('AGE'), 30);
});

test('returns number values unchanged', () => {
  assert.strictEqual(toValue(42), 42);
  assert.strictEqual(toValue(0), 0);
  assert.strictEqual(toValue(-1.5), -1.5);
});

test('returns string values unchanged', () => {
  assert.strictEqual(toValue('hello'), 'hello');
  assert.strictEqual(toValue(''), '');
});

test('returns boolean values unchanged', () => {
  assert.strictEqual(toValue(true), true);
  assert.strictEqual(toValue(false), false);
});

test('throws TypeError for function input', () => {
  assert.throws(() => toValue(() => {}), TypeError);
});
