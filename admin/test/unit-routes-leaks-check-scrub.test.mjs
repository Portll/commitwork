// Replaces runs of >=8 non-space chars from a matched line with [redacted] (admin/routes/leaks-check.mjs scrub).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrub } from '../routes/leaks-check.mjs';

test('returns empty string when text is falsy', () => {
  assert.equal(scrub('', 'abcdefgh'), '');
  assert.equal(scrub(null, 'abcdefgh'), '');
  assert.equal(scrub(undefined, 'abcdefgh'), '');
});

test('returns text unchanged when matchedLine is empty', () => {
  assert.equal(scrub('hello world', ''), 'hello world');
  assert.equal(scrub('hello world', null), 'hello world');
  assert.equal(scrub('hello world', undefined), 'hello world');
});

test('redacts a single token of exactly 8 chars', () => {
  assert.equal(scrub('abc defghijk', 'defghijk'), 'abc [redacted]');
});

test('redacts a single token of 7 chars leaves it unchanged', () => {
  assert.equal(scrub('abc defghij', 'defghij'), 'abc defghij');
});

test('redacts multiple tokens sorted longest first', () => {
  const text = 'short abcdefghij klmnopqrst';
  const matched = 'abcdefghij klmnopqrst';
  assert.equal(scrub(text, matched), 'short [redacted] [redacted]');
});

test('redacts token containing shorter token leaves only one redaction', () => {
  const text = 'prefix abcdefghij suffix';
  const matched = 'abcdefghij';
  assert.equal(scrub(text, matched), 'prefix [redacted] suffix');
});

test('splits on quotes and punctuation to extract tokens', () => {
  const text = 'value is "abcdefghij" here';
  const matched = '"abcdefghij"';
  assert.equal(scrub(text, matched), "value is \"[redacted]\" here");
});

test('handles tokens with parentheses and brackets', () => {
  const text = 'call (abcdefghij) done';
  const matched = '(abcdefghij)';
  assert.equal(scrub(text, matched), "call ([redacted]) done");
});

test('redacts repeated occurrences of the same token', () => {
  const token = 'abcdefghij';
  const text = token + ' ' + token + ' ' + token;
  assert.equal(scrub(text, token), '[redacted] [redacted] [redacted]');
});

test('does not redact tokens shorter than 8 chars even if present', () => {
  const text = 'abc def ghi jklmno';
  const matched = 'abc def ghi jklmno';
  assert.equal(scrub(text, matched), 'abc def ghi jklmno');
});
