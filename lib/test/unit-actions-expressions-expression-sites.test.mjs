// Finds GitHub Actions expression sites in a string (lib/actions-expressions.mjs expressionSites).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expressionSites } from '../actions-expressions.mjs';

test('returns empty array when no expression is present', () => {
  assert.deepEqual(expressionSites('hello world'), []);
});

test('returns single site for a simple expression', () => {
  assert.deepEqual(expressionSites('${{ github.ref }}'), [
    { start: 0, end: 17, expression: 'github.ref' }
  ]);
});

test('returns two sites for two expressions', () => {
  assert.deepEqual(expressionSites('${{ a }} and ${{ b }}'), [
    { start: 0, end: 8, expression: 'a' },
    { start: 13, end: 21, expression: 'b' }
  ]);
});

test('returns site with null expression when closing braces are missing', () => {
  assert.deepEqual(expressionSites('${{ github.ref'), [
    { start: 0, end: 14, expression: null }
  ]);
});

test('ignores closing braces inside single-quoted strings', () => {
  assert.deepEqual(expressionSites("${{ 'a}}b' }}"), [
    { start: 0, end: 13, expression: "'a}}b'" }
  ]);
});

test('handles expression with spaces that are trimmed', () => {
  assert.deepEqual(expressionSites('${{  github.ref  }}'), [
    { start: 0, end: 19, expression: 'github.ref' }
  ]);
});

test('returns site ending at string length when unclosed', () => {
  const input = 'prefix ${{ x';
  assert.deepEqual(expressionSites(input), [
    { start: 7, end: input.length, expression: null }
  ]);
});

test('handles expression with nested braces outside strings', () => {
  assert.deepEqual(expressionSites('${{ {a: 1} }}'), [
    { start: 0, end: 13, expression: '{a: 1}' }
  ]);
});
