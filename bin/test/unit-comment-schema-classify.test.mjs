// Classifies a comment block as reference or narrative based on first line and reference line proportion (bin/comment-schema.mjs classify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../comment-schema.mjs';

test('returns narrative for empty block', () => {
  assert.equal(classify([]), 'narrative');
});

test('returns narrative for block with only whitespace lines', () => {
  assert.equal(classify(['   ', '  /*  */', '  *  ']), 'narrative');
});

test('returns reference when first line matches usage keyword', () => {
  assert.equal(classify(['Usage: run the tool', 'some other line', 'another line']), 'reference');
});

test('returns reference when first line matches exit codes keyword', () => {
  assert.equal(classify(['Exit codes: 0 success', 'narrative line', 'more text']), 'reference');
});

test('returns reference when first line matches env keyword', () => {
  assert.equal(classify(['Env: FOO=bar', 'narrative', 'text']), 'reference');
});

test('returns reference when first line matches @param keyword', () => {
  assert.equal(classify(['@param {string} name', 'narrative line', 'text']), 'reference');
});

test('returns narrative when first line does not match and proportion is below threshold', () => {
  const block = ['narrative line', 'Usage: something', 'more narrative', 'still narrative'];
  assert.equal(classify(block), 'narrative');
});

test('returns reference when first line does not match and proportion meets threshold', () => {
  const block = ['narrative line', 'Usage: something', 'Env: FOO=bar', 'more narrative', 'still narrative'];
  assert.equal(classify(block), 'reference');
});

test('returns narrative when proportion is exactly below threshold', () => {
  const block = ['narrative line', 'Usage: something', 'more narrative'];
  assert.equal(classify(block), 'narrative');
});

test('returns reference when proportion is exactly at threshold', () => {
  const block = ['narrative line', 'Usage: something'];
  assert.equal(classify(block), 'reference');
});
