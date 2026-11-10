// Extracts significant tokens from texts, filtering out short words and stopwords. (lib/taxonomy-distance.mjs tokens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokens } from '../taxonomy-distance.mjs';

test('returns empty array for no arguments', () => {
  assert.deepEqual(tokens(), []);
});

test('skips null and undefined arguments', () => {
  assert.deepEqual(tokens(null, undefined, 'hello world'), ["hello", "world"]);
});

test('filters out words shorter than three characters', () => {
  assert.deepEqual(tokens('ab cat dog'), ["cat", "dog"]);
});

test('filters out stop words', () => {
  assert.deepEqual(tokens('the cat and dog'), ["cat", "dog"]);
});

test('keeps words of exactly three characters that are not stop words', () => {
  assert.deepEqual(tokens('cat dog'), ["cat", "dog"]);
});

test('filters out words of exactly three characters that are stop words', () => {
  assert.deepEqual(tokens('the and'), []);
});

test('keeps words of four characters that are not stop words', () => {
  assert.deepEqual(tokens('bird'), ["bird"]);
});

test('handles multiple text arguments', () => {
  assert.deepEqual(tokens('hello', 'world', 'foo'), ["hello", "world", "foo"]);
});

test('splits on non-alphanumeric characters and lowercases', () => {
  assert.deepEqual(tokens('Hello-World_Foo'), ["hello", "world", "foo"]);
});

test('handles numbers in text', () => {
  assert.deepEqual(tokens('abc123 def'), ["abc123", "def"]);
});
