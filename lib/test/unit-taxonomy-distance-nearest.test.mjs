// Finds the most similar candidate vector by cosine similarity (lib/taxonomy-distance.mjs nearest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearest } from '../taxonomy-distance.mjs';

test('returns null when candidates list is empty', () => {
  const v = new Map([['a', 1]]);
  const r = nearest(v, []);
  assert.deepEqual(r, null);
});

test('returns null when the only candidate is excluded', () => {
  const v = new Map([['a', 1]]);
  const c = { id: 'x', vec: new Map([['a', 1]]) };
  const r = nearest(v, [c], { excludeId: 'x' });
  assert.deepEqual(r, null);
});

test('returns the single candidate when excludeId is null', () => {
  const v = new Map([['a', 1]]);
  const c = { id: 'x', vec: new Map([['a', 1]]) };
  const r = nearest(v, [c]);
  assert.deepEqual(r, { id: "x", sim: 1, distance: 0 });
});

test('returns the single candidate when excludeId differs from its id', () => {
  const v = new Map([['a', 1]]);
  const c = { id: 'x', vec: new Map([['a', 1]]) };
  const r = nearest(v, [c], { excludeId: 'y' });
  assert.deepEqual(r, { id: "x", sim: 1, distance: 0 });
});

test('picks the candidate with strictly higher similarity', () => {
  const v = new Map([['a', 1]]);
  const c1 = { id: 'a', vec: new Map([['a', 1]]) };
  const c2 = { id: 'b', vec: new Map([['a', 1], ['b', 1]]) };
  const r = nearest(v, [c1, c2]);
  assert.deepEqual(r, { id: "a", sim: 1, distance: 0 });
});

test('picks the candidate with strictly lower similarity when it appears first', () => {
  const v = new Map([['a', 1]]);
  const c1 = { id: 'a', vec: new Map([['a', 1], ['b', 1]]) };
  const c2 = { id: 'b', vec: new Map([['a', 1]]) };
  const r = nearest(v, [c1, c2]);
  assert.deepEqual(r, { id: "a", sim: 1, distance: 0 });
});

test('breaks a similarity tie by choosing the smaller id', () => {
  const v = new Map([['a', 1]]);
  const c1 = { id: 'b', vec: new Map([['a', 1]]) };
  const c2 = { id: 'a', vec: new Map([['a', 1]]) };
  const r = nearest(v, [c1, c2]);
  assert.deepEqual(r, { id: "a", sim: 1, distance: 0 });
});

test('keeps the earlier candidate when ids are equal and similarities tie', () => {
  const v = new Map([['a', 1]]);
  const c1 = { id: 'a', vec: new Map([['a', 1]]) };
  const c2 = { id: 'a', vec: new Map([['a', 1]]) };
  const r = nearest(v, [c1, c2]);
  assert.deepEqual(r, { id: "a", sim: 1, distance: 0 });
});

test('excludes the named candidate and returns the remaining one', () => {
  const v = new Map([['a', 1]]);
  const c1 = { id: 'a', vec: new Map([['a', 1]]) };
  const c2 = { id: 'b', vec: new Map([['a', 1]]) };
  const r = nearest(v, [c1, c2], { excludeId: 'a' });
  assert.deepEqual(r, { id: "b", sim: 1, distance: 0 });
});

test('returns null when all candidates are excluded', () => {
  const v = new Map([['a', 1]]);
  const c1 = { id: 'a', vec: new Map([['a', 1]]) };
  const c2 = { id: 'b', vec: new Map([['a', 1]]) };
  const r = nearest(v, [c1, c2], { excludeId: 'a' });
  assert.deepEqual(r, { id: "b", sim: 1, distance: 0 });
});
