// Flags scanner lanes whose undetermined share is near-total (admin/lib/adjudication-triage.mjs defectLanes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defectLanes } from '../lib/adjudication-triage.mjs';

test('returns empty object when rollup is null', () => {
  assert.deepStrictEqual(defectLanes(null), {});
});

test('returns empty object when rollup has no scanners', () => {
  assert.deepStrictEqual(defectLanes({}), {});
});

test('returns empty object when scanners is not an object', () => {
  assert.deepStrictEqual(defectLanes({ scanners: 'bad' }), {});
});

test('skips lane entries that are not objects', () => {
  const rollup = { scanners: { a: null, b: 42, c: 'x' } };
  assert.deepStrictEqual(defectLanes(rollup), {});
});

test('excludes lane when undetermined is below DEFECT_MIN_ROWS', () => {
  const rollup = { scanners: { a: { undetermined: 19, total: 20 } } };
  assert.deepStrictEqual(defectLanes(rollup), {});
});

test('excludes lane when total is zero', () => {
  const rollup = { scanners: { a: { undetermined: 20, total: 0 } } };
  assert.deepStrictEqual(defectLanes(rollup), {});
});

test('excludes lane when share is below DEFECT_SHARE', () => {
  const rollup = { scanners: { a: { undetermined: 19, total: 20 } } };
  assert.deepStrictEqual(defectLanes(rollup), {});
});

test('includes lane when undetermined equals DEFECT_MIN_ROWS and share equals DEFECT_SHARE', () => {
  const rollup = { scanners: { a: { undetermined: 20, total: 21 } } };
  const expected = { a: { undetermined: 20, total: 21, share: Math.round((20 / 21) * 1000) / 1000 } };
  assert.deepStrictEqual(defectLanes(rollup), expected);
});

test('includes lane when share exceeds DEFECT_SHARE', () => {
  const rollup = { scanners: { a: { undetermined: 20, total: 20 } } };
  const expected = { a: { undetermined: 20, total: 20, share: 1 } };
  assert.deepStrictEqual(defectLanes(rollup), expected);
});

test('handles multiple lanes and filters correctly', () => {
  const rollup = {
    scanners: {
      good: { undetermined: 5, total: 100 },
      bad: { undetermined: 95, total: 100 },
      edge: { undetermined: 20, total: 21 }
    }
  };
  const expected = {
    bad: { undetermined: 95, total: 100, share: 0.95 },
    edge: { undetermined: 20, total: 21, share: Math.round((20 / 21) * 1000) / 1000 }
  };
  assert.deepStrictEqual(defectLanes(rollup), expected);
});
