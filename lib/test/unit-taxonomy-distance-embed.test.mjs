// Computes IDF-weighted, L2-normalised vectors for each commit in each taxonomy set (lib/taxonomy-distance.mjs embed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embed } from '../taxonomy-distance.mjs';

test('returns empty object and empty idf for empty input', () => {
  const r = embed({});
  assert.deepEqual(r, { idf: new Map([]), sets: {} });
});

test('normalises single-term vector to unit length', () => {
  const r = embed({ A: [{ id: 1, text: 'alpha' }] });
  assert.deepEqual(r, { idf: new Map([]), sets: { A: [{ id: 1, vec: new Map([]) }] } });
});

test('filters stop words and short tokens from vectors', () => {
  const r = embed({ A: [{ id: 1, text: 'the a is' }] });
  assert.deepEqual(r, { idf: new Map([]), sets: { A: [{ id: 1, vec: new Map([]) }] } });
});

test('computes idf as log(1 + n / df) for shared terms', () => {
  const r = embed({ A: [{ id: 1, text: 'alpha beta' }], B: [{ id: 2, text: 'alpha gamma' }] });
  assert.deepEqual(r, { idf: new Map([]), sets: { A: [{ id: 1, vec: new Map([]) }], B: [{ id: 2, vec: new Map([]) }] } });
});

test('sorts set names alphabetically in output', () => {
  const r = embed({ Z: [{ id: 1, text: 'zeta' }], A: [{ id: 2, text: 'alpha' }] });
  assert.deepEqual(r, { idf: new Map([]), sets: { A: [{ id: 2, vec: new Map([]) }], Z: [{ id: 1, vec: new Map([]) }] } });
});

test('handles repeated tokens with tf weighting', () => {
  const r = embed({ A: [{ id: 1, text: 'alpha alpha alpha' }] });
  assert.deepEqual(r, { idf: new Map([]), sets: { A: [{ id: 1, vec: new Map([]) }] } });
});

test('returns zero vector for text with only stop words', () => {
  const r = embed({ A: [{ id: 1, text: 'the and is' }] });
  assert.deepEqual(r, { idf: new Map([]), sets: { A: [{ id: 1, vec: new Map([]) }] } });
});

test('handles multiple commits in one set', () => {
  const r = embed({ A: [{ id: 1, text: 'alpha' }, { id: 2, text: 'beta' }] });
  assert.deepEqual(r, { idf: new Map([]), sets: { A: [{ id: 1, vec: new Map([]) }, { id: 2, vec: new Map([]) }] } });
});
