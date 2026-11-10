// ruleTitleText computes a trimmed title string or null from text and id (monitor/sarif-read.mjs ruleTitleText)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleTitleText } from '../sarif-read.mjs';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(resolve(import.meta.url));

test('returns null for empty text', () => {
  const result = ruleTitleText('');
  assert.equal(result, null);
});

test('returns null for generic title', () => {
  const result = ruleTitleText('error');
  assert.equal(result, null);
});

test('returns null when text equals id', () => {
  const result = ruleTitleText('warning', 'warning');
  assert.equal(result, null);
});

test('returns null when text includes id', () => {
  const result = ruleTitleText('issue123', 'issue');
  assert.equal(result, null);
});

test('returns truncated title when longer than max', () => {
  const longText = 'x'.repeat(150);
  const result = ruleTitleText(longText);
  assert.equal(result, 'x'.repeat(99) + '\u2026');
});

test('returns full title when within max', () => {
  const result = ruleTitleText('valid title');
  assert.equal(result, 'valid title');
});

test('strips control characters and normalizes whitespace', () => {
  const result = ruleTitleText('\u0000\u0001test  \n\nstring\u007f');
  assert.equal(result, 'test string');
});

test('throws TypeError when text is null', () => {
  assert.equal(ruleTitleText(null), null);
});

test('returns null for id-only input with no text', () => {
  const result = ruleTitleText('', 'someid');
  assert.equal(result, null);
});
