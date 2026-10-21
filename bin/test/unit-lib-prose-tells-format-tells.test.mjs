// Formats found prose tells into a multi-line string (bin/lib/prose-tells.mjs formatTells).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTells } from '../lib/prose-tells.mjs';

test('returns empty string for empty array', () => {
  const result = formatTells([]);
  assert.equal(result, '');
});

test('formats single tell with line, id, match, and why', () => {
  const found = [{ line: 1, id: 'T1', match: 'hello', why: 'greeting' }];
  const result = formatTells(found);
  assert.equal(result, '  \u00b7 line 1 [T1] "hello" \u2014 greeting');
});

test('formats multiple tells joined by newline', () => {
  const found = [
    { line: 2, id: 'A', match: 'foo', why: 'reason A' },
    { line: 3, id: 'B', match: 'bar', why: 'reason B' }
  ];
  const result = formatTells(found);
  assert.equal(result, '  \u00b7 line 2 [A] "foo" \u2014 reason A\n  \u00b7 line 3 [B] "bar" \u2014 reason B');
});

test('preserves exact spacing and punctuation in output', () => {
  const found = [{ line: 10, id: 'X', match: 'test', why: 'check' }];
  const result = formatTells(found);
  assert.equal(result, '  \u00b7 line 10 [X] "test" \u2014 check');
});

test('handles tell with empty match string', () => {
  const found = [{ line: 5, id: 'E', match: '', why: 'empty' }];
  const result = formatTells(found);
  assert.equal(result, '  \u00b7 line 5 [E] "" \u2014 empty');
});

test('handles tell with empty why string', () => {
  const found = [{ line: 7, id: 'W', match: 'word', why: '' }];
  const result = formatTells(found);
  assert.equal(result, '  \u00b7 line 7 [W] "word" \u2014 ');
});

test('handles tell with empty id string', () => {
  const found = [{ line: 3, id: '', match: 'val', why: 'desc' }];
  const result = formatTells(found);
  assert.equal(result, '  \u00b7 line 3 [] "val" \u2014 desc');
});

test('handles tell with line number zero', () => {
  const found = [{ line: 0, id: 'Z', match: 'zero', why: 'origin' }];
  const result = formatTells(found);
  assert.equal(result, '  \u00b7 line 0 [Z] "zero" \u2014 origin');
});

test('handles tell with negative line number', () => {
  const found = [{ line: -1, id: 'N', match: 'neg', why: 'invalid' }];
  const result = formatTells(found);
  assert.equal(result, '  \u00b7 line -1 [N] "neg" \u2014 invalid');
});

test('handles tell with large line number', () => {
  const found = [{ line: 999999, id: 'L', match: 'big', why: 'large' }];
  const result = formatTells(found);
  assert.equal(result, '  \u00b7 line 999999 [L] "big" \u2014 large');
});
