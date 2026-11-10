// strips comments, strings, and template bodies, keeping code (bin/bare-catch-ratchet.mjs stripNonCode).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripNonCode } from '../bare-catch-ratchet.mjs';

test('blanks single-line comments and preserves newlines', () => {
  assert.equal(stripNonCode('a // x\nb'), "a     \nb");
});

test('blanks block comments and preserves newlines', () => {
  assert.equal(stripNonCode('a /* x\ny */ b'), "a     \n     b");
});

test('throws on unterminated block comment', () => {
  assert.throws(() => stripNonCode('/* x'), { message: 'unterminated block comment' });
});

test('blanks single-quoted strings', () => {
  assert.equal(stripNonCode("a 'x y' b"), "a       b");
});

test('blanks double-quoted strings', () => {
  assert.equal(stripNonCode('a "x y" b'), "a       b");
});

test('blanks template literals and preserves newlines', () => {
  assert.equal(stripNonCode('a `x\ny` b'), 'a   \n   b');
});

test('throws on unterminated template literal', () => {
  assert.throws(() => stripNonCode('`x'), { message: 'unterminated template literal' });
});

test('blanks regex literals in expression position', () => {
  assert.equal(stripNonCode('a = /x/'), "a =    ");
});

test('keeps division when preceded by identifier', () => {
  assert.equal(stripNonCode('a / b'), 'a / b');
});

test('keeps division when preceded by closing paren', () => {
  assert.equal(stripNonCode('(a) / b'), '(a) / b');
});
