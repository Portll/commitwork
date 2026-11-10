// Computes inverse document frequency for each term (lib/taxonomy-distance.mjs idfOver).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idfOver } from '../taxonomy-distance.mjs';

test('returns an empty map when docs is empty', () => {
  const r = idfOver([]);
  assert.deepEqual(r, new Map([]));
});

test('computes idf for a single document with one term', () => {
  const r = idfOver([['a']]);
  assert.deepEqual(r, new Map([["a", 0.6931471805599453]]));
});

test('computes idf for a single document with multiple terms', () => {
  const r = idfOver([['a', 'b', 'c']]);
  assert.deepEqual(r, new Map([["a", 0.6931471805599453], ["b", 0.6931471805599453], ["c", 0.6931471805599453]]));
});

test('computes idf for two documents sharing one term', () => {
  const r = idfOver([['a'], ['a']]);
  assert.deepEqual(r, new Map([["a", 0.6931471805599453]]));
});

test('computes idf for two documents with disjoint terms', () => {
  const r = idfOver([['a'], ['b']]);
  assert.deepEqual(r, new Map([["a", 1.0986122886681096], ["b", 1.0986122886681096]]));
});

test('computes idf for three documents where one term appears in all', () => {
  const r = idfOver([['a', 'b'], ['a', 'c'], ['a']]);
  assert.deepEqual(r, new Map([["a", 0.6931471805599453], ["b", 1.3862943611198906], ["c", 1.3862943611198906]]));
});

test('computes idf for a document with duplicate terms', () => {
  const r = idfOver([['a', 'a', 'b']]);
  assert.deepEqual(r, new Map([["a", 0.6931471805599453], ["b", 0.6931471805599453]]));
});

test('computes idf for many documents with varying term frequencies', () => {
  const docs = Array.from({ length: 5 }, (_, i) => ['x', 'y', 'z'].slice(0, i + 1));
  const r = idfOver(docs);
  assert.deepEqual(r, new Map([["x", 0.6931471805599453], ["y", 0.8109302162163288], ["z", 0.9808292530117264]]));
});
