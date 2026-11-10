// Extracts measurement verdicts from prose (bin/rate-llm.mjs extractMeasurement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMeasurement } from '../rate-llm.mjs';

test('returns docs verdict when docs-doctor line is present', () => {
  const r = extractMeasurement('re-derived docs-doctor at abc1234: green');
  assert.deepEqual(r, { docsVerdict: "green" });
});

test('returns null when no floor is present', () => {
  const r = extractMeasurement('re-ran the suite at abc1234 twice: 1 failing, 2 passing');
  assert.equal(r, null);
});

test('returns floor and suite counts when floor and suite are present', () => {
  const r = extractMeasurement('against the floor of 5 re-ran the suite at abc1234 twice: 3 failing, 7 passing');
  assert.deepEqual(r, { floor: 5, fail: 3, pass: 7 });
});

test('returns floor and fail count when floor and head are present', () => {
  const r = extractMeasurement('against the floor of 10 pristine HEAD re-measures 2 failing');
  assert.deepEqual(r, { floor: 10, fail: 2 });
});

test('returns null when floor is present but no suite or head', () => {
  const r = extractMeasurement('against the floor of 5');
  assert.equal(r, null);
});

test('handles null input by returning null', () => {
  const r = extractMeasurement(null);
  assert.equal(r, null);
});

test('handles undefined input by returning null', () => {
  const r = extractMeasurement(undefined);
  assert.equal(r, null);
});

test('returns docs verdict with orange status', () => {
  const r = extractMeasurement('re-derived docs-doctor at def5678: orange');
  assert.deepEqual(r, { docsVerdict: "orange" });
});
