// Maps a character offset to its 1-based line number (flow/lexer.mjs lineIndexer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineIndexer } from '../lexer.mjs';

test('returns line 1 for an empty source', () => {
  const fn = lineIndexer('');
  assert.equal(fn(0), 1);
});

test('returns line 1 for an offset before the first newline', () => {
  const fn = lineIndexer('abc');
  assert.equal(fn(2), 1);
});

test('returns line 2 for an offset at the first newline', () => {
  const fn = lineIndexer('a\nb');
  assert.equal(fn(1), 1);
});

test('returns line 2 for an offset after the first newline', () => {
  const fn = lineIndexer('a\nb');
  assert.equal(fn(2), 2);
});

test('returns line 3 for an offset at the second newline', () => {
  const fn = lineIndexer('a\nb\nc');
  assert.equal(fn(3), 2);
});

test('returns line 3 for an offset after the second newline', () => {
  const fn = lineIndexer('a\nb\nc');
  assert.equal(fn(4), 3);
});

test('returns the last line for an offset past the final newline', () => {
  const fn = lineIndexer('a\nb\nc');
  assert.equal(fn(100), 3);
});

test('returns line 2 for a source with a newline at index zero', () => {
  const fn = lineIndexer('\n');
  assert.equal(fn(0), 1);
});

test('returns line 2 for a source with a newline at index zero and offset one', () => {
  const fn = lineIndexer('\n');
  assert.equal(fn(1), 2);
});

test('returns line 3 for a source with two newlines at even indices', () => {
  const fn = lineIndexer('\n\n');
  assert.equal(fn(1), 2);
});
