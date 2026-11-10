// Detects if a string is a long camelCase identifier (bin/lib/secret-heuristics.mjs looksLikeIdentifier).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeIdentifier } from '../lib/secret-heuristics.mjs';

test('returns false for short strings', () => {
  assert.equal(looksLikeIdentifier('abc'), false);
});

test('returns false for single word without vowels', () => {
  assert.equal(looksLikeIdentifier('xyz'), false);
});

test('returns false for two valid words', () => {
  assert.equal(looksLikeIdentifier('helloWorld'), false);
});

test('returns true for three valid words', () => {
  assert.equal(looksLikeIdentifier('helloWorldFoo'), true);
});

test('returns false for camelCase with three or more segments', () => {
  assert.equal(looksLikeIdentifier('myVariableName'), false);
});

test('returns false when segments are too short', () => {
  assert.equal(looksLikeIdentifier('abCdEf'), false);
});

test('returns false when segments lack vowels', () => {
  assert.equal(looksLikeIdentifier('xyzAbcDef'), false);
});

test('handles mixed case boundaries correctly', () => {
  assert.equal(looksLikeIdentifier('parseJSONData'), false);
});
