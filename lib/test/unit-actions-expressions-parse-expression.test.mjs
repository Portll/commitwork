// Parses a commitwork actions expression string into an AST (lib/actions-expressions.mjs parseExpression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpression } from '../actions-expressions.mjs';

test('parses a simple numeric literal', () => {
  const ast = parseExpression('42');
  assert.deepEqual(ast, { type: 'literal', value: 42 });
});

test('parses a boolean literal', () => {
  const ast = parseExpression('true');
  assert.deepEqual(ast, { type: 'literal', value: true });
});

test('parses a string literal', () => {
  const ast = parseExpression("'hello'");
  assert.deepEqual(ast, { type: 'literal', value: 'hello' });
});

test('parses a null literal', () => {
  const ast = parseExpression('null');
  assert.deepEqual(ast, { type: 'literal', value: null });
});

test('parses a grouped expression', () => {
  const ast = parseExpression('(1)');
  assert.deepEqual(ast, {
    type: 'group',
    expr: { type: 'literal', value: 1 }
  });
});

test('parses a logical AND expression', () => {
  const ast = parseExpression('true && false');
  assert.deepEqual(ast, {
    type: 'logical',
    op: '&&',
    args: [
      { type: 'literal', value: true },
      { type: 'literal', value: false }
    ]
  });
});

test('parses a logical OR expression', () => {
  const ast = parseExpression('false || true');
  assert.deepEqual(ast, {
    type: 'logical',
    op: '||',
    args: [
      { type: 'literal', value: false },
      { type: 'literal', value: true }
    ]
  });
});

test('parses a comparison expression', () => {
  const ast = parseExpression('1 < 2');
  assert.deepEqual(ast, {
    type: 'binary',
    op: '<',
    left: { type: 'literal', value: 1 },
    right: { type: 'literal', value: 2 }
  });
});

test('parses a unary NOT expression', () => {
  const ast = parseExpression('!true');
  assert.deepEqual(ast, {
    type: 'unary',
    op: '!',
    expr: { type: 'literal', value: true }
  });
});

test('parses a builtin function call', () => {
  const ast = parseExpression("contains('hello', 'ell')");
  assert.deepEqual(ast, {
    type: 'call',
    name: 'contains',
    args: [
      { type: 'literal', value: 'hello' },
      { type: 'literal', value: 'ell' }
    ]
  });
});

test('rejects a named value that is not an allowed context, naming its position', () => {
  assert.throws(() => parseExpression('nope'), { message: "Unrecognized named-value: 'nope'. Located at position 1 within expression: nope" });
  assert.doesNotThrow(() => parseExpression('github', { contexts: ['github'] }));
});
