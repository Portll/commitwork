// Computes a normalized TF-IDF vector from tokens and an IDF map (lib/taxonomy-distance.mjs vec).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vec } from '../taxonomy-distance.mjs';

test('returns an empty map when the token list is empty', () => {
  const idf = new Map([['a', 1]]);
  const r = vec([], idf);
  assert.deepEqual(r, new Map([]));
});

test('returns an empty map when every token has zero idf', () => {
  const idf = new Map([['a', 0], ['b', 0]]);
  const r = vec(['a', 'b'], idf);
  assert.deepEqual(r, new Map([]));
});

test('returns an empty map when every token is missing from the idf map', () => {
  const idf = new Map([['x', 5]]);
  const r = vec(['a', 'b'], idf);
  assert.deepEqual(r, new Map([]));
});

test('normalizes a single token with idf one to unit weight', () => {
  const idf = new Map([['a', 1]]);
  const r = vec(['a'], idf);
  assert.deepEqual(r, new Map([["a", 1]]));
});

test('counts repeated tokens with the log term in the weight', () => {
  const idf = new Map([['a', 1]]);
  const r = vec(['a', 'a', 'a'], idf);
  assert.deepEqual(r, new Map([["a", 1]]));
});

test('normalizes two distinct tokens with equal idf to equal weights', () => {
  const idf = new Map([['a', 1], ['b', 1]]);
  const r = vec(['a', 'b'], idf);
  assert.deepEqual(r, new Map([["a", 0.7071067811865475], ["b", 0.7071067811865475]]));
});

test('scales weights by the idf value for each token', () => {
  const idf = new Map([['a', 2], ['b', 1]]);
  const r = vec(['a', 'b'], idf);
  assert.deepEqual(r, new Map([["a", 0.8944271909999159], ["b", 0.4472135954999579]]));
});

test('drops tokens whose idf is zero while keeping the rest', () => {
  const idf = new Map([['a', 1], ['b', 0]]);
  const r = vec(['a', 'b'], idf);
  assert.deepEqual(r, new Map([["a", 1]]));
});

test('normalizes a mixed bag of repeated and distinct tokens', () => {
  const idf = new Map([['a', 1], ['b', 2], ['c', 3]]);
  const r = vec(['a', 'a', 'b', 'c', 'c', 'c'], idf);
  assert.deepEqual(r, new Map([["a", 0.24828364521027366], ["b", 0.29328064099916357], ["c", 0.9232235358439573]]));
});
