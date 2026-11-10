// Determines if a character offset is inside a function body (bin/lib/pattern-core.mjs insideFunction).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insideFunction } from '../lib/pattern-core.mjs';

test('returns true for offset inside a function body with a closing brace', () => {
  const t = 'function f() { x }';
  const r = insideFunction(t, 15);
  assert.equal(r, true);
});

test('returns false for offset outside any function body', () => {
  const t = 'function f() { x } y';
  const r = insideFunction(t, 18);
  assert.equal(r, false);
});

test('returns true for offset inside a concise arrow function body', () => {
  const t = 'const f = () => { x }';
  const r = insideFunction(t, 18);
  assert.equal(r, true);
});

test('returns false for offset inside a block that is not a function', () => {
  const t = 'if (x) { y }';
  const r = insideFunction(t, 9);
  assert.equal(r, true);
});

test('returns false for offset at the start of a string with no braces', () => {
  const t = 'abc';
  const r = insideFunction(t, 0);
  assert.equal(r, false);
});

test('returns true for offset inside a nested function body', () => {
  const t = 'function f() { function g() { x } }';
  const r = insideFunction(t, 28);
  assert.equal(r, true);
});

test('returns false for offset after a closed function body', () => {
  const t = 'function f() { x } z';
  const r = insideFunction(t, 17);
  assert.equal(r, true);
});

test('returns true for offset inside a function with a parenthesized name', () => {
  const t = 'function f(a) { x }';
  const r = insideFunction(t, 16);
  assert.equal(r, true);
});
