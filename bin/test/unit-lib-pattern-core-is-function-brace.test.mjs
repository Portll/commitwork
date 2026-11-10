// Detects whether a brace follows a function call or arrow (bin/lib/pattern-core.mjs isFunctionBrace).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFunctionBrace } from '../lib/pattern-core.mjs';

test('returns true when the non-whitespace char before the brace is a closing paren', () => {
  const t = 'f() {';
  assert.equal(isFunctionBrace(t, 4), true);
});

test('returns true when the non-whitespace char before the brace is a greater-than after an equals', () => {
  const t = 'a => {';
  assert.equal(isFunctionBrace(t, 5), true);
});

test('returns false when the non-whitespace char before the brace is a letter', () => {
  const t = 'a {';
  assert.equal(isFunctionBrace(t, 2), false);
});

test('returns false when the non-whitespace char before the brace is a greater-than without an equals', () => {
  const t = 'a > {';
  assert.equal(isFunctionBrace(t, 4), false);
});

test('returns false when the non-whitespace char before the brace is an equals without a greater-than', () => {
  const t = 'a = {';
  assert.equal(isFunctionBrace(t, 4), false);
});

test('returns false when the brace is at the start of the string', () => {
  const t = '{';
  assert.equal(isFunctionBrace(t, 0), false);
});

test('returns true when the non-whitespace char before the brace is a closing paren with leading whitespace', () => {
  const t = 'f(  )  {';
  assert.equal(isFunctionBrace(t, 7), true);
});

test('returns true when the non-whitespace char before the brace is a greater-than after an equals with leading whitespace', () => {
  const t = 'a  =>  {';
  assert.equal(isFunctionBrace(t, 7), true);
});
