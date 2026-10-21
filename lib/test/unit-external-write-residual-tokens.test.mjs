// Computes the sorted, de-duplicated redaction tokens whose source names still appear in a text (lib/external-write.mjs residualTokens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { residualTokens } from '../external-write.mjs';

test('returns empty array when no entry source appears in text', () => {
  const result = residualTokens('hello world', [['foo', 'bar']]);
  assert.deepEqual(result, []);
});

test('returns sorted target when source appears as a whole word', () => {
  const result = residualTokens('the foo is here', [['foo', 'bar']]);
  assert.deepEqual(result, ['bar']);
});

test('returns target when source appears as substring within a word', () => {
  const result = residualTokens('the foobar is here', [['foo', 'bar']]);
  assert.deepEqual(result, ['bar']);
});

test('returns target when source appears with different casing', () => {
  const result = residualTokens('the FOO is here', [['foo', 'bar']]);
  assert.deepEqual(result, ['bar']);
});

test('returns target when source contains non-alphanumeric characters that are stripped', () => {
  const result = residualTokens('the f-o-o is here', [['f-o-o', 'bar']]);
  assert.deepEqual(result, ['bar']);
});

test('returns multiple sorted targets when multiple entries match', () => {
  const result = residualTokens('foo and bar', [['foo', 'zeta'], ['bar', 'alpha']]);
  assert.deepEqual(result, ['alpha', 'zeta']);
});

test('returns unique targets even when multiple entries map to same target', () => {
  const result = residualTokens('foo and foo', [['foo', 'bar'], ['foo', 'bar']]);
  assert.deepEqual(result, ['bar']);
});

test('returns empty array when source normalises to empty string', () => {
  const result = residualTokens('foo bar', [['!!!', 'baz']]);
  assert.deepEqual(result, []);
});

test('handles text with multiple whitespace separators', () => {
  const result = residualTokens('foo\tbar\nbaz', [['foo', 'x']]);
  assert.deepEqual(result, ['x']);
});

test('returns empty array for empty text', () => {
  const result = residualTokens('', [['foo', 'bar']]);
  assert.deepEqual(result, []);
});
