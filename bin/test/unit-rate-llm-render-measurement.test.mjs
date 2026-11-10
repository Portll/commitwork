// Renders a measurement summary string (bin/rate-llm.mjs renderMeasurement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMeasurement } from '../rate-llm.mjs';

test('returns null for non-object inputs', () => {
  assert.equal(renderMeasurement(null), null);
});

test('returns null when fail is not a non-negative integer', () => {
  assert.equal(renderMeasurement({ fail: 1.5, floor: 1 }), null);
});

test('returns null when floor is not a non-negative integer', () => {
  assert.equal(renderMeasurement({ fail: 1, floor: -1 }), null);
});

test('returns null when fail is valid but floor is missing', () => {
  assert.equal(renderMeasurement({ fail: 1 }), null);
});

test('returns null when floor is valid but fail is missing', () => {
  assert.equal(renderMeasurement({ floor: 1 }), null);
});

test('returns docs verdict string when docsVerdict is a non-empty string', () => {
  assert.equal(renderMeasurement({ docsVerdict: 'ok' }), "docs-doctor, re-derived from the tree at that same commit, returned: ok");
});

test('returns null when docsVerdict is an empty string', () => {
  assert.equal(renderMeasurement({ docsVerdict: '' }), null);
});

test('returns null when docsVerdict is a non-string truthy value', () => {
  assert.equal(renderMeasurement({ docsVerdict: 1 }), null);
});

test('returns measurement string with pass count and corroborated tests', () => {
  assert.equal(renderMeasurement({ fail: 2, floor: 3, pass: 4, corroboratedTests: ['a', 'b'] }), "the suite, re-run at that same commit, measured 2 failing / 4 passing, against the stored floor of 3 failing. tests failing in both this re-run and the records taken at the time: a; b.");
});

test('returns measurement string without pass count when pass is missing', () => {
  assert.equal(renderMeasurement({ fail: 2, floor: 3 }), "the suite, re-run at that same commit, measured 2 failing, against the stored floor of 3 failing.");
});
