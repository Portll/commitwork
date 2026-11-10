// Levenshtein distance with transposition support (monitor/lookalike.mjs editDistance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editDistance } from '../lookalike.mjs';

test('returns zero when both inputs are the same string', () => {
  assert.equal(editDistance('abc', 'abc'), 0);
});

test('returns the length of the other string when one input is empty', () => {
  assert.equal(editDistance('', 'hello'), 5);
});

test('returns the length of the first string when the second is empty', () => {
  assert.equal(editDistance('world', ''), 5);
});

test('computes the distance for strings of different lengths', () => {
  assert.equal(editDistance('kitten', 'sitting'), 3);
});

test('computes the distance for strings of equal length with substitutions', () => {
  assert.equal(editDistance('flaw', 'flow'), 1);
});

test('computes the distance for a single character difference', () => {
  assert.equal(editDistance('a', 'b'), 1);
});

test('computes the distance for a transposition of adjacent characters', () => {
  assert.equal(editDistance('ab', 'ba'), 1);
});

test('computes the distance for a longer transposition pattern', () => {
  assert.equal(editDistance('abcd', 'bcda'), 2);
});

test('computes the distance for repeated characters', () => {
  assert.equal(editDistance('aaaa', 'aa'), 2);
});

test('computes the distance for a single character string versus empty', () => {
  assert.equal(editDistance('x', ''), 1);
});
