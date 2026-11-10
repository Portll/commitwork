// Per-lens usage counts and sorted uncovered lenses (bin/scanner-taxonomy-render.mjs lensCoverage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lensCoverage } from '../scanner-taxonomy-render.mjs';

test('counts each lens once per occurrence across classes and lists unused lenses', () => {
  const doc = {
    classes: [{ lens: ['beta', 'alpha'] }, { lens: ['alpha'] }],
    lenses: { alpha: {}, beta: {}, gamma: {} },
  };
  assert.deepEqual(lensCoverage(doc), {
    counts: { alpha: 2, beta: 1 },
    uncovered: ['gamma'],
  });
});

test('counts a lens repeated three times within one class as three', () => {
  const doc = {
    classes: [{ lens: Array.from({ length: 3 }, () => 'x') }],
    lenses: { x: {} },
  };
  assert.deepEqual(lensCoverage(doc), { counts: { x: 3 }, uncovered: [] });
});

test('orders counts keys alphabetically regardless of first use', () => {
  const doc = {
    classes: [{ lens: ['gamma'] }, { lens: ['alpha', 'beta'] }],
    lenses: {},
  };
  const r = lensCoverage(doc);
  assert.deepEqual(r, { counts: { alpha: 1, beta: 1, gamma: 1 }, uncovered: [] });
  assert.deepEqual(Object.keys(r.counts), ['alpha', 'beta', 'gamma']);
});

test('lists uncovered lenses sorted and skips any lens a class uses', () => {
  const doc = {
    classes: [{ lens: ['mid'] }],
    lenses: { zeta: {}, mid: {}, alpha: {} },
  };
  assert.deepEqual(lensCoverage(doc), {
    counts: { mid: 1 },
    uncovered: ['alpha', 'zeta'],
  });
});

test('returns empty counts and every lens uncovered when there are no classes', () => {
  const doc = { classes: [], lenses: { b: {}, a: {} } };
  assert.deepEqual(lensCoverage(doc), { counts: {}, uncovered: ['a', 'b'] });
});

test('returns empty counts and empty uncovered for classes with empty lens lists', () => {
  const doc = { classes: [{ lens: [] }], lenses: {} };
  assert.deepEqual(lensCoverage(doc), { counts: {}, uncovered: [] });
});

test('keeps the later count when a number and a string lens share one property key', () => {
  const doc = {
    classes: [{ lens: [1] }, { lens: ['1', '1'] }],
    lenses: { 1: {}, 2: {} },
  };
  assert.deepEqual(lensCoverage(doc), { counts: { 1: 2 }, uncovered: ['2'] });
});

test('keeps the later count when two distinct object lenses stringify to the same key', () => {
  const a = { toString: () => 'k' };
  const b = { toString: () => 'k' };
  const doc = {
    classes: [{ lens: [a] }, { lens: [b, b] }],
    lenses: { m: {}, k: {} },
  };
  assert.deepEqual(lensCoverage(doc), { counts: { k: 2 }, uncovered: ['k', 'm'] });
});
