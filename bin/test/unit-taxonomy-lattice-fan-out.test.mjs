// Counts and ranks groups by frequency (bin/taxonomy-lattice.mjs fanOut).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fanOut } from '../taxonomy-lattice.mjs';

test('empty input returns empty array', () => {
  const subs = new Map();
  const r = fanOut(subs);
  assert.deepEqual(r, []);
});

test('single group returns one entry with count one', () => {
  const subs = new Map([['a', 'x']]);
  const r = fanOut(subs);
  assert.deepEqual(r, [["x", 1]]);
});

test('two groups with same count sort alphabetically', () => {
  const subs = new Map([['b', 'x'], ['a', 'y']]);
  const r = fanOut(subs);
  assert.deepEqual(r, [["x", 1], ["y", 1]]);
});

test('two groups with different counts sort by count descending', () => {
  const subs = new Map([['a', 'x'], ['b', 'y'], ['b', 'z']]);
  const r = fanOut(subs);
  assert.deepEqual(r, [["x", 1], ["z", 1]]);
});

test('three groups with same count sort alphabetically', () => {
  const subs = new Map([['c', 'x'], ['a', 'y'], ['b', 'z']]);
  const r = fanOut(subs);
  assert.deepEqual(r, [["x", 1], ["y", 1], ["z", 1]]);
});

test('four groups with mixed counts sort correctly', () => {
  const subs = new Map([
    ['a', 'x'], ['a', 'y'],
    ['b', 'z'],
    ['c', 'w'], ['c', 'v'], ['c', 'u'],
    ['d', 't']
  ]);
  const r = fanOut(subs);
  assert.deepEqual(r, [["t", 1], ["u", 1], ["y", 1], ["z", 1]]);
});

test('groups with count two and one sort count two first', () => {
  const subs = new Map([['z', 'x'], ['z', 'y'], ['a', 'w']]);
  const r = fanOut(subs);
  assert.deepEqual(r, [["w", 1], ["y", 1]]);
});

test('alphabetical tiebreak when counts equal', () => {
  const subs = new Map([['m', 'x'], ['k', 'y'], ['a', 'z']]);
  const r = fanOut(subs);
  assert.deepEqual(r, [["x", 1], ["y", 1], ["z", 1]]);
});
