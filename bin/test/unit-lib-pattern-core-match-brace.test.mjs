// Finds the index of the closing brace matching the opening brace at openIdx (bin/lib/pattern-core.mjs matchBrace).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchBrace } from '../lib/pattern-core.mjs';

test('returns the index of the matching closing brace for a simple pair', () => {
  const r = matchBrace('a{b}c', 1);
  assert.equal(r, 3);
});

test('returns the index of the outer closing brace for nested braces', () => {
  const r = matchBrace('x{y{z}w}', 1);
  assert.equal(r, 7);
});

test('returns -1 when no closing brace exists', () => {
  const r = matchBrace('a{b', 1);
  assert.equal(r, -1);
});

test('returns -1 when the opening brace is at the end of the string', () => {
  const r = matchBrace('a{', 1);
  assert.equal(r, -1);
});

test('returns -1 when the string is empty', () => {
  const r = matchBrace('', 0);
  assert.equal(r, -1);
});

test('returns the index of the closing brace when openIdx points to a non-brace character', () => {
  const r = matchBrace('a{b}c', 0);
  assert.equal(r, 3);
});

test('returns -1 when the string contains only opening braces', () => {
  const r = matchBrace('{{{', 0);
  assert.equal(r, -1);
});

test('returns the index of the closing brace for deeply nested braces', () => {
  const r = matchBrace('a{b{c{d}e}f}', 1);
  assert.equal(r, 11);
});
