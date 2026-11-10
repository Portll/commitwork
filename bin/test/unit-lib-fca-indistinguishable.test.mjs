// Groups object ids whose attribute arrays are identical (bin/lib/fca.mjs indistinguishable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indistinguishable } from '../lib/fca.mjs';

test('returns empty array when input is empty', () => {
  assert.deepEqual(indistinguishable({}), []);
});

test('returns empty array when all signatures are unique', () => {
  assert.deepEqual(indistinguishable({ a: ['x'], b: ['y'], c: ['z'] }), []);
});

test('returns single group when two objects share a signature', () => {
  assert.deepEqual(indistinguishable({ a: ['x', 'y'], b: ['y', 'x'] }), [["a", "b"]]);
});

test('returns multiple groups sorted by first id', () => {
  assert.deepEqual(indistinguishable({ b: ['p'], a: ['p'], d: ['q'], c: ['q'] }), [["a", "b"], ["c", "d"]]);
});

test('returns empty array when no group has more than one member', () => {
  assert.deepEqual(indistinguishable({ a: ['x'], b: ['y'] }), []);
});

test('returns empty array when all groups have exactly one member', () => {
  assert.deepEqual(indistinguishable({ a: ['x'], b: ['y'], c: ['z'] }), []);
});

test('returns empty array when all groups have exactly two members', () => {
  assert.deepEqual(indistinguishable({ a: ['x'], b: ['x'], c: ['y'], d: ['y'] }), [["a", "b"], ["c", "d"]]);
});

test('returns empty array when all groups have exactly three members', () => {
  assert.deepEqual(indistinguishable({ a: ['x'], b: ['x'], c: ['x'], d: ['y'], e: ['y'], f: ['y'] }), [["a", "b", "c"], ["d", "e", "f"]]);
});

test('returns empty array when all groups have exactly four members', () => {
  assert.deepEqual(indistinguishable({ a: ['x'], b: ['x'], c: ['x'], d: ['x'], e: ['y'], f: ['y'], g: ['y'], h: ['y'] }), [["a", "b", "c", "d"], ["e", "f", "g", "h"]]);
});

test('returns empty array when all groups have exactly five members', () => {
  assert.deepEqual(indistinguishable({ a: ['x'], b: ['x'], c: ['x'], d: ['x'], e: ['x'], f: ['y'], g: ['y'], h: ['y'], i: ['y'], j: ['y'] }), [["a", "b", "c", "d", "e"], ["f", "g", "h", "i", "j"]]);
});
