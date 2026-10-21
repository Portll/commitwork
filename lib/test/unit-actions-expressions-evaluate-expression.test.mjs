// Evaluates a parsed or string expression against a context (lib/actions-expressions.mjs evaluateExpression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpression } from '../actions-expressions.mjs';

test('returns null for an undefined AST', () => {
  assert.equal(evaluateExpression(undefined, {}), null);
});

test('evaluates a string literal expression', () => {
  assert.equal(evaluateExpression("'hello'", {}), 'hello');
});

test('evaluates a number literal expression', () => {
  assert.equal(evaluateExpression('42', {}), 42);
});

test('evaluates a boolean literal expression', () => {
  assert.equal(evaluateExpression('true', {}), true);
  assert.equal(evaluateExpression('false', {}), false);
});

test('evaluates a null literal expression', () => {
  assert.equal(evaluateExpression('null', {}), null);
});

test('evaluates a context reference', () => {
  assert.equal(evaluateExpression('name', { name: 'Alice' }), 'Alice');
});

test('evaluates equality comparison with case-insensitive strings', () => {
  assert.equal(evaluateExpression("'Hello' == 'hello'", {}), true);
  assert.equal(evaluateExpression("'Hello' == 'world'", {}), false);
});

test('evaluates inequality comparison', () => {
  assert.equal(evaluateExpression("'a' != 'b'", {}), true);
  assert.equal(evaluateExpression("'a' != 'a'", {}), false);
});

test('evaluates greater-than comparison with numbers', () => {
  assert.equal(evaluateExpression('5 > 3', {}), true);
  assert.equal(evaluateExpression('3 > 5', {}), false);
  assert.equal(evaluateExpression('5 > 5', {}), false);
});

test('evaluates greater-or-equal and less-or-equal comparisons', () => {
  assert.equal(evaluateExpression('5 >= 5', {}), true);
  assert.equal(evaluateExpression('5 >= 3', {}), true);
  assert.equal(evaluateExpression('3 >= 5', {}), false);
  assert.equal(evaluateExpression('3 <= 3', {}), true);
  assert.equal(evaluateExpression('3 <= 5', {}), true);
  assert.equal(evaluateExpression('5 <= 3', {}), false);
});

test('evaluates an index into a context object', () => {
  assert.equal(evaluateExpression("a['b']", { a: { b: 1 } }), 1);
});

test('evaluates logical and with short-circuit', () => {
  assert.equal(evaluateExpression('true && true', {}), true);
  assert.equal(evaluateExpression('false && true', {}), false);
  assert.equal(evaluateExpression('true && false', {}), false);
});

test('evaluates logical or with short-circuit', () => {
  assert.equal(evaluateExpression('false || true', {}), true);
  assert.equal(evaluateExpression('true || false', {}), true);
  assert.equal(evaluateExpression('false || false', {}), false);
});

test('evaluates unary negation', () => {
  assert.equal(evaluateExpression('!true', {}), false);
  assert.equal(evaluateExpression('!false', {}), true);
  assert.equal(evaluateExpression('!0', {}), true);
  assert.equal(evaluateExpression('!1', {}), false);
});

test('evaluates a builtin function call', () => {
  assert.equal(evaluateExpression("contains('hello world', 'world')", {}), true);
  assert.equal(evaluateExpression("contains('hello world', 'xyz')", {}), false);
});

test('evaluates a group expression', () => {
  assert.equal(evaluateExpression('(1)', {}), 1);
});
