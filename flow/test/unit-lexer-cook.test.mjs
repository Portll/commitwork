// Decodes escape sequences in a raw string (flow/lexer.mjs cook).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cook } from '../lexer.mjs';

test('returns raw string unchanged when it contains no backslash', () => {
  assert.equal(cook('hello world'), "hello world");
});

test('decodes backslash-n as newline', () => {
  assert.equal(cook('a\\nb'), "a\nb");
});

test('decodes backslash-t as tab', () => {
  assert.equal(cook('a\\tb'), "a\tb");
});

test('decodes backslash-r as carriage return', () => {
  assert.equal(cook('a\\rb'), "a\rb");
});

test('decodes escaped backslash as single backslash', () => {
  assert.equal(cook('a\\\\b'), "a\\b");
});

test('decodes escaped single quote as single quote', () => {
  assert.equal(cook("a\\'b"), "a'b");
});

test('decodes escaped double quote as double quote', () => {
  assert.equal(cook('a\\"b'), "a\"b");
});

test('decodes escaped backtick as backtick', () => {
  assert.equal(cook('a\\`b'), "a`b");
});

test('decodes escaped forward slash as forward slash', () => {
  assert.equal(cook('a\\/b'), "a/b");
});

test('decodes escaped newline as empty string for line continuation', () => {
  assert.equal(cook('a\\\nb'), "ab");
});

test('decodes unicode escape with braces as code point', () => {
  assert.equal(cook('\\u{41}'), "A");
});

test('returns null for unclosed unicode escape with braces', () => {
  assert.equal(cook('\\u{41'), null);
});

test('decodes four-digit unicode escape as character', () => {
  assert.equal(cook('\\u0041'), "A");
});

test('decodes two-digit hex escape as character', () => {
  assert.equal(cook('\\x41'), "A");
});

test('returns null for invalid hex escape with non-hex characters', () => {
  assert.equal(cook('\\xZZ'), null);
});

test('returns null for unknown escape sequence', () => {
  assert.equal(cook('\\q'), null);
});
