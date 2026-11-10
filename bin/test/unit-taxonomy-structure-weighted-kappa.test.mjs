// Quadratic-weighted Cohen's kappa agreement between two raters (bin/taxonomy-structure.mjs weightedKappa).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weightedKappa } from '../taxonomy-structure.mjs';

test('returns null when the rating arrays are empty', () => {
  const r = weightedKappa([], []);
  assert.equal(r, null);
});

test('returns 1 when every rating falls in one category so the expected disagreement is zero', () => {
  const a = Array.from({ length: 3 }, () => 2);
  const b = Array.from({ length: 3 }, () => 2);
  const r = weightedKappa(a, b);
  assert.equal(r, 1);
});

test('returns 0 when both disagreements sit in the last category column', () => {
  const r = weightedKappa([0, 1], [4, 4]);
  assert.equal(r, 0);
});

test('returns 0 when the observed disagreement in the first column equals the expected one', () => {
  const r = weightedKappa([4, 0], [0, 0]);
  assert.equal(r, 0);
});

test('returns 0.875 for four items with two adjacent-category disagreements', () => {
  const r = weightedKappa([0, 1, 3, 4], [0, 2, 3, 3]);
  assert.equal(r, 0.875);
});

test('uses the custom category count for the weights and the matrix size', () => {
  const r = weightedKappa([0, 1, 2, 2], [0, 2, 2, 1], 2);
  assert.equal(r, 1 - 0.5 / 1.375);
});

test('throws when a first-rater category is above the default maximum of 4', () => {
  assert.throws(() => weightedKappa([5], [0]), {
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading '0')",
  });
});
