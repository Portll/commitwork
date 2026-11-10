// per-member nearest-neighbor distances and their median/min/max (lib/taxonomy-distance.mjs internalBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { internalBaseline } from '../taxonomy-distance.mjs';

test('returns the no-scale object when there are zero members', () => {
  const r = internalBaseline([]);
  assert.deepEqual(r, { n: 0, median: null, min: null, max: null, sorted: [], why: "fewer than two members \u2014 a set with no internal pair has no scale of its own, and a borrowed one would be a bound with no cause" });
});

test('returns the no-scale object when there is one member', () => {
  const r = internalBaseline([{ id: 'a', vec: new Map([['x', 1]]) }]);
  assert.deepEqual(r, { n: 1, median: null, min: null, max: null, sorted: [], why: "fewer than two members \u2014 a set with no internal pair has no scale of its own, and a borrowed one would be a bound with no cause" });
});

test('computes distances for two members with identical vectors', () => {
  const v = new Map([['x', 1]]);
  const r = internalBaseline([{ id: 'a', vec: v }, { id: 'b', vec: v }]);
  assert.deepEqual(r, { n: 2, median: 0, min: 0, max: 0, sorted: [0, 0], rows: [{ id: "a", nearest: "b", distance: 0 }, { id: "b", nearest: "a", distance: 0 }] });
});

test('computes distances for two members with orthogonal vectors', () => {
  const r = internalBaseline([
    { id: 'a', vec: new Map([['x', 1]]) },
    { id: 'b', vec: new Map([['y', 1]]) }
  ]);
  assert.deepEqual(r, { n: 2, median: 1, min: 1, max: 1, sorted: [1, 1], rows: [{ id: "a", nearest: "b", distance: 1 }, { id: "b", nearest: "a", distance: 1 }] });
});

test('computes distances for three members with distinct vectors', () => {
  const r = internalBaseline([
    { id: 'a', vec: new Map([['x', 1]]) },
    { id: 'b', vec: new Map([['y', 1]]) },
    { id: 'c', vec: new Map([['z', 1]]) }
  ]);
  assert.deepEqual(r, { n: 3, median: 1, min: 1, max: 1, sorted: [1, 1, 1], rows: [{ id: "a", nearest: "b", distance: 1 }, { id: "b", nearest: "a", distance: 1 }, { id: "c", nearest: "a", distance: 1 }] });
});

test('computes distances for three members where two share a vector', () => {
  const v = new Map([['x', 1]]);
  const r = internalBaseline([
    { id: 'a', vec: v },
    { id: 'b', vec: v },
    { id: 'c', vec: new Map([['y', 1]]) }
  ]);
  assert.deepEqual(r, { n: 3, median: 0, min: 0, max: 1, sorted: [0, 0, 1], rows: [{ id: "a", nearest: "b", distance: 0 }, { id: "b", nearest: "a", distance: 0 }, { id: "c", nearest: "a", distance: 1 }] });
});

test('computes distances for four members with mixed similarity', () => {
  const r = internalBaseline([
    { id: 'a', vec: new Map([['x', 1]]) },
    { id: 'b', vec: new Map([['x', 1]]) },
    { id: 'c', vec: new Map([['y', 1]]) },
    { id: 'd', vec: new Map([['y', 1]]) }
  ]);
  assert.deepEqual(r, { n: 4, median: 0, min: 0, max: 0, sorted: [0, 0, 0, 0], rows: [{ id: "a", nearest: "b", distance: 0 }, { id: "b", nearest: "a", distance: 0 }, { id: "c", nearest: "d", distance: 0 }, { id: "d", nearest: "c", distance: 0 }] });
});
