// Maps each detector to its class and counts independent bases (monitor/detector-basis.mjs basesOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basesOf } from '../detector-basis.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const map = {
  classes: { a: {}, b: {} },
  detectors: { d1: 'a', d2: 'b' }
};

test('returns empty result for null detectors', () => {
  const r = basesOf(null, map);
  assert.deepEqual(r, { bases: {}, independentBases: 0, unclassified: [] });
});

test('returns empty result for empty array', () => {
  const r = basesOf([], map);
  assert.deepEqual(r, { bases: {}, independentBases: 0, unclassified: [] });
});

test('returns empty result for undefined detectors', () => {
  const r = basesOf(undefined, map);
  assert.deepEqual(r, { bases: {}, independentBases: 0, unclassified: [] });
});

test('maps known detectors to their classes', () => {
  const r = basesOf(['d1', 'd2'], map);
  assert.deepEqual(r, { bases: { d1: "a", d2: "b" }, independentBases: 2, unclassified: [] });
});

test('marks unknown detectors as unclassified', () => {
  const r = basesOf(['d1', 'unknown'], map);
  assert.deepEqual(r, { bases: { d1: "a", unknown: "unclassified" }, independentBases: 1, unclassified: ["unknown"] });
});

test('deduplicates repeated detectors', () => {
  const r = basesOf(['d1', 'd1', 'd1'], map);
  assert.deepEqual(r, { bases: { d1: "a" }, independentBases: 1, unclassified: [] });
});

test('counts distinct classes as independent bases', () => {
  const r = basesOf(['d1', 'd2'], map);
  assert.deepEqual(r, { bases: { d1: "a", d2: "b" }, independentBases: 2, unclassified: [] });
});

test('handles all unclassified detectors', () => {
  const r = basesOf(['x', 'y'], map);
  assert.deepEqual(r, { bases: { x: "unclassified", y: "unclassified" }, independentBases: 0, unclassified: ["x", "y"] });
});
