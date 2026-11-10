// Computes normalized TF-IDF vectors for a corpus of token arrays (bin/taxonomy-structure.mjs tfidf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tfidf } from '../taxonomy-structure.mjs';

test('computes tf-idf for a single document with repeated tokens', () => {
  const r = tfidf([['a', 'a', 'b']]);
  assert.deepEqual(r, [new Map([["a", 0], ["b", 0]])]);
});

test('computes tf-idf for two documents sharing a token', () => {
  const r = tfidf([['a', 'b'], ['a', 'c']]);
  assert.deepEqual(r, [new Map([["a", 0], ["b", 1]]), new Map([["a", 0], ["c", 1]])]);
});

test('computes tf-idf for three documents with distinct tokens', () => {
  const r = tfidf([['x'], ['y'], ['z']]);
  assert.deepEqual(r, [new Map([["x", 1]]), new Map([["y", 1]]), new Map([["z", 1]])]);
});

test('computes tf-idf when a token appears in all documents', () => {
  const r = tfidf([['a', 'b'], ['a', 'c'], ['a', 'd']]);
  assert.deepEqual(r, [new Map([["a", 0], ["b", 1]]), new Map([["a", 0], ["c", 1]]), new Map([["a", 0], ["d", 1]])]);
});

test('computes tf-idf for a document with a single token', () => {
  const r = tfidf([['solo']]);
  assert.deepEqual(r, [new Map([["solo", 0]])]);
});

test('computes tf-idf for two documents with identical tokens', () => {
  const r = tfidf([['a', 'b'], ['a', 'b']]);
  assert.deepEqual(r, [new Map([["a", 0], ["b", 0]]), new Map([["a", 0], ["b", 0]])]);
});

test('computes tf-idf for a document with many repeated tokens', () => {
  const r = tfidf([Array.from({ length: 10 }, () => 'w')]);
  assert.deepEqual(r, [new Map([["w", 0]])]);
});

test('computes tf-idf for documents of different lengths', () => {
  const r = tfidf([['a'], ['a', 'a', 'a', 'b']]);
  assert.deepEqual(r, [new Map([["a", 0]]), new Map([["a", 0], ["b", 1]])]);
});
