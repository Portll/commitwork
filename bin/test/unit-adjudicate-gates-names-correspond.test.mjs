// Checks whether any measured name is present in the recorded set (bin/adjudicate-gates.mjs namesCorrespond).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namesCorrespond } from '../adjudicate-gates.mjs';

test('returns true when both recorded and measured are empty', () => {
  assert.equal(namesCorrespond([], []), true);
});

test('returns true when both are empty Sets', () => {
  assert.equal(namesCorrespond(new Set(), new Set()), true);
});

test('returns true when a measured name exists in recorded', () => {
  assert.equal(namesCorrespond(['a', 'b'], ['b', 'c']), true);
});

test('returns true when measured is a Set with a matching name', () => {
  assert.equal(namesCorrespond(['x', 'y'], new Set(['y'])), true);
});

test('returns true when recorded is a Set and measured is an array with a match', () => {
  assert.equal(namesCorrespond(new Set(['p', 'q']), ['q', 'r']), true);
});

test('returns false when measured has names but none are in recorded', () => {
  assert.equal(namesCorrespond(['a', 'b'], ['c', 'd']), false);
});

test('returns false when recorded is empty but measured is not', () => {
  assert.equal(namesCorrespond([], ['anything']), false);
});

test('returns false when recorded is a non-empty Set and measured is a non-matching Set', () => {
  assert.equal(namesCorrespond(new Set(['a']), new Set(['b'])), false);
});

test('returns true for large inputs with a single shared name', () => {
  const rec = Array.from({ length: 1000 }, (_, i) => 'r' + i);
  const mes = Array.from({ length: 1000 }, (_, i) => 'm' + i);
  mes[500] = 'r500';
  assert.equal(namesCorrespond(rec, mes), true);
});

test('returns false for large inputs with no shared names', () => {
  const rec = Array.from({ length: 1000 }, (_, i) => 'r' + i);
  const mes = Array.from({ length: 1000 }, (_, i) => 'm' + i);
  assert.equal(namesCorrespond(rec, mes), false);
});
