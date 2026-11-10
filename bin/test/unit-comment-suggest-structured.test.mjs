// Detects whether a comment block has structural content that should not be collapsed (bin/comment-suggest.mjs structured).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structured } from '../comment-suggest.mjs';

test('returns true when two lines match the list pattern', () => {
  const block = ['1. first item', '2. second item'];
  assert.equal(structured(block), true);
});

test('returns false when only one line matches the list pattern', () => {
  const block = ['1. first item', 'plain text line'];
  assert.equal(structured(block), false);
});

test('returns true when a line matches the quoted pipe pattern', () => {
  const block = ["'a' | 'b'"];
  assert.equal(structured(block), true);
});

test('returns true when two lines match the html tag pattern', () => {
  const block = ['<div>content</div>', '<span>more</span>'];
  assert.equal(structured(block), true);
});

test('returns false when only one line matches the html tag pattern', () => {
  const block = ['<div>content</div>', 'plain text'];
  assert.equal(structured(block), false);
});

test('returns true when two lines match the term definition pattern', () => {
  const block = ['alpha \u2014 definition one', 'beta \u2014 definition two'];
  assert.equal(structured(block), true);
});

test('returns false when only one line matches the term definition pattern', () => {
  const block = ['alpha \u2014 definition one', 'plain text'];
  assert.equal(structured(block), false);
});

test('returns false for a block with no structural patterns', () => {
  const block = ['just a plain sentence', 'another plain sentence'];
  assert.equal(structured(block), false);
});

test('returns false for an empty block', () => {
  assert.equal(structured([]), false);
});

test('returns true when two lines match the arrow pattern', () => {
  const block = ['input -> output', 'data -> result'];
  assert.equal(structured(block), true);
});
