// Computes which specifiers are covered by non-null span values (flow/verify.mjs specifierCoverage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { specifierCoverage } from '../verify.mjs';

test('returns checked count and empty missing when all specifiers are covered', () => {
  const specifiers = ['a', 'b'];
  const spans = [{ value: 'a' }, { value: 'b' }];
  const r = specifierCoverage(specifiers, spans);
  assert.deepEqual(r, { checked: 2, missing: [] });
});

test('returns missing specifiers that have no matching non-null span value', () => {
  const specifiers = ['a', 'b', 'c'];
  const spans = [{ value: 'a' }, { value: null }];
  const r = specifierCoverage(specifiers, spans);
  assert.deepEqual(r, { checked: 3, missing: ["b", "c"] });
});

test('excludes null span values from coverage set', () => {
  const specifiers = ['a', 'b'];
  const spans = [{ value: null }, { value: 'a' }];
  const r = specifierCoverage(specifiers, spans);
  assert.deepEqual(r, { checked: 2, missing: ["b"] });
});

test('returns zero checked and all specifiers missing when spans is empty', () => {
  const specifiers = ['x', 'y'];
  const spans = [];
  const r = specifierCoverage(specifiers, spans);
  assert.deepEqual(r, { checked: 2, missing: ["x", "y"] });
});

test('returns zero checked and empty missing when specifiers is empty', () => {
  const specifiers = [];
  const spans = [{ value: 'a' }, { value: null }];
  const r = specifierCoverage(specifiers, spans);
  assert.deepEqual(r, { checked: 0, missing: [] });
});

test('deduplicates span values so repeated specifiers are all covered', () => {
  const specifiers = ['a', 'a', 'a'];
  const spans = [{ value: 'a' }, { value: 'a' }];
  const r = specifierCoverage(specifiers, spans);
  assert.deepEqual(r, { checked: 3, missing: [] });
});

test('keeps missing entries in original specifier order', () => {
  const specifiers = ['z', 'a', 'm', 'b'];
  const spans = [{ value: 'a' }, { value: 'b' }];
  const r = specifierCoverage(specifiers, spans);
  assert.deepEqual(r, { checked: 4, missing: ["z", "m"] });
});

test('treats zero and empty string as valid non-null values', () => {
  const specifiers = [0, '', 'x'];
  const spans = [{ value: 0 }, { value: '' }];
  const r = specifierCoverage(specifiers, spans);
  assert.deepEqual(r, { checked: 3, missing: ["x"] });
});
