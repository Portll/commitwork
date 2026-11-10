// Splits cveTotals and scanner rows into per-kind severity buckets, skipping non-additive lanes (monitor/lane-kinds.mjs partitionByKind).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionByKind } from '../lane-kinds.mjs';

test('returns zeroed buckets for all kinds and unclassified when inputs are empty', () => {
  const result = partitionByKind({}, {});
  assert.deepEqual(result, { vulnerability: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } });
});

test('adds cveTotals to the vulnerability bucket', () => {
  const cveTotals = { crit: 2, high: 3, med: 4, low: 5, undetermined: 6 };
  const result = partitionByKind(cveTotals, {});
  assert.deepEqual(result, { vulnerability: { crit: 2, high: 3, med: 4, low: 5, undetermined: 6 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } });
});

test('routes a known scanner lane to its declared kind', () => {
  const scanners = { secrets: { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 } };
  const result = partitionByKind({}, scanners);
  assert.deepEqual(result, { vulnerability: { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } });
});

test('routes an unknown scanner lane to unclassified', () => {
  const scanners = { unknownLane: { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 } };
  const result = partitionByKind({}, scanners);
  assert.deepEqual(result, { vulnerability: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 } });
});

test('skips non-additive lanes from the flat sum', () => {
  const scanners = {
    depsReachability: { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 },
    secrets: { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 }
  };
  const result = partitionByKind({}, scanners);
  assert.deepEqual(result, { vulnerability: { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } });
});

test('partitions a lane with byKind into its sub-kinds', () => {
  const scanners = {
    supplyChain: {
      byKind: {
        vulnerability: { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 },
        policy: { crit: 6, high: 7, med: 8, low: 9, undetermined: 10 }
      }
    }
  };
  const result = partitionByKind({}, scanners);
  assert.deepEqual(result, { vulnerability: { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 6, high: 7, med: 8, low: 9, undetermined: 10 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } });
});

test('routes unrecognised byKind keys to unclassified', () => {
  const scanners = {
    supplyChain: {
      byKind: {
        vulnerability: { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 },
        bogusKind: { crit: 6, high: 7, med: 8, low: 9, undetermined: 10 }
      }
    }
  };
  const result = partitionByKind({}, scanners);
  assert.deepEqual(result, { vulnerability: { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 6, high: 7, med: 8, low: 9, undetermined: 10 } });
});

test('treats null scanner values as zero contributions', () => {
  const scanners = { secrets: null, depsReachability: null };
  const result = partitionByKind({}, scanners);
  assert.deepEqual(result, { vulnerability: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } });
});

test('handles missing cveTotals and null scanners gracefully', () => {
  const result = partitionByKind(null, null);
  assert.deepEqual(result, { vulnerability: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } });
});
