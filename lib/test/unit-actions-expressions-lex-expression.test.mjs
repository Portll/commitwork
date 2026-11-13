// Lexical analysis of expression strings into tokens (lib/actions-expressions.mjs lexExpression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lexExpression } from '../actions-expressions.mjs';

test('lexExpression accepts input at max length', () => {
  const input = 'a'.repeat(21000);
  const result = lexExpression(input);
  assert.deepEqual(result, [
    { type: 'identifier', lexeme: input, value: undefined, pos: 0 },
    { type: 'eof', lexeme: '', value: undefined, pos: 21000 }
  ]);
});

test('lexExpression rejects input exceeding max length', () => {
  const input = 'a'.repeat(21001);
  assert.throws(() => lexExpression(input), {
    name: 'Error',
    message: 'Exceeded max expression length 21000'
  });
});

test('lexExpression tokenizes chained property access using previous token', () => {
  const input = 'a.b.c';
  const result = lexExpression(input);
  assert.deepEqual(result, [
    { type: 'identifier', lexeme: 'a', value: undefined, pos: 0 },
    { type: 'dot', lexeme: '.', value: undefined, pos: 1 },
    { type: 'identifier', lexeme: 'b', value: undefined, pos: 2 },
    { type: 'dot', lexeme: '.', value: undefined, pos: 3 },
    { type: 'identifier', lexeme: 'c', value: undefined, pos: 4 },
    { type: 'eof', lexeme: '', value: undefined, pos: 5 }
  ]);
});

test('lexExpression parses decimal numbers', () => {
  const input = '1.5';
  const result = lexExpression(input);
  assert.deepEqual(result, [
    { type: 'number', lexeme: '1.5', value: 1.5, pos: 0 },
    { type: 'eof', lexeme: '', value: undefined, pos: 3 }
  ]);
});

test('lexExpression recognizes true keyword at start', () => {
  const input = 'true';
  const result = lexExpression(input);
  assert.deepEqual(result, [
    { type: 'true', lexeme: 'true', value: undefined, pos: 0 },
    { type: 'eof', lexeme: '', value: undefined, pos: 4 }
  ]);
});

test('lexExpression treats true as identifier after dot', () => {
  const input = 'a.true';
  const result = lexExpression(input);
  assert.deepEqual(result, [
    { type: 'identifier', lexeme: 'a', value: undefined, pos: 0 },
    { type: 'dot', lexeme: '.', value: undefined, pos: 1 },
    { type: 'identifier', lexeme: 'true', value: undefined, pos: 2 },
    { type: 'eof', lexeme: '', value: undefined, pos: 6 }
  ]);
});

test('lexExpression recognizes false keyword', () => {
  const input = 'false';
  const result = lexExpression(input);
  assert.deepEqual(result, [
    { type: 'false', lexeme: 'false', value: undefined, pos: 0 },
    { type: 'eof', lexeme: '', value: undefined, pos: 5 }
  ]);
});

test('lexExpression recognizes Infinity keyword', () => {
  const input = 'Infinity';
  const result = lexExpression(input);
  assert.deepEqual(result, [
    { type: 'number', lexeme: 'Infinity', value: Infinity, pos: 0 },
    { type: 'eof', lexeme: '', value: undefined, pos: 8 }
  ]);
});

test('lexExpression parses strings with escaped quotes', () => {
  const input = "'hello''world'";
  const result = lexExpression(input);
  assert.deepEqual(result, [
    { type: 'string', lexeme: "'hello''world'", value: "hello'world", pos: 0 },
    { type: 'eof', lexeme: '', value: undefined, pos: 14 }
  ]);
});

test('lexExpression distinguishes dot operator from decimal point after identifier', () => {
  const input = 'a.b';
  const result = lexExpression(input);
  assert.deepEqual(result, [
    { type: 'identifier', lexeme: 'a', value: undefined, pos: 0 },
    { type: 'dot', lexeme: '.', value: undefined, pos: 1 },
    { type: 'identifier', lexeme: 'b', value: undefined, pos: 2 },
    { type: 'eof', lexeme: '', value: undefined, pos: 3 }
  ]);
});

test('lexExpression parses decimal point at start as number', () => {
  const input = '.5';
  const result = lexExpression(input);
  assert.deepEqual(result, [
    { type: 'number', lexeme: '.5', value: 0.5, pos: 0 },
    { type: 'eof', lexeme: '', value: undefined, pos: 2 }
  ]);
});

test('lexExpression tokenizes greater than and greater equal operators', () => {
  const input = 'a>b a>=c';
  const result = lexExpression(input);
  assert.deepEqual(result, [
    { type: 'identifier', lexeme: 'a', value: undefined, pos: 0 },
    { type: 'greater', lexeme: '>', value: undefined, pos: 1 },
    { type: 'identifier', lexeme: 'b', value: undefined, pos: 2 },
    { type: 'identifier', lexeme: 'a', value: undefined, pos: 4 },
    { type: 'greaterEqual', lexeme: '>=', value: undefined, pos: 5 },
    { type: 'identifier', lexeme: 'c', value: undefined, pos: 7 },
    { type: 'eof', lexeme: '', value: undefined, pos: 8 }
  ]);
});

test('lexExpression treats unrecognized identifier as identifier', () => {
  const input = 'foo';
  const result = lexExpression(input);
  assert.deepEqual(result, [
    { type: 'identifier', lexeme: 'foo', value: undefined, pos: 0 },
    { type: 'eof', lexeme: '', value: undefined, pos: 3 }
  ]);
});

test('lexExpression treats dot after rbracket as dot operator', () => {
  const input = '[1].2';
  const result = lexExpression(input);
  assert.deepEqual(result, [
    { type: 'lbracket', lexeme: '[', value: undefined, pos: 0 },
    { type: 'number', lexeme: '1', value: 1, pos: 1 },
    { type: 'rbracket', lexeme: ']', value: undefined, pos: 2 },
    { type: 'dot', lexeme: '.', value: undefined, pos: 3 },
    { type: 'number', lexeme: '2', value: 2, pos: 4 },
    { type: 'eof', lexeme: '', value: undefined, pos: 5 }
  ]);
});
