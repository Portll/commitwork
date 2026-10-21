// monitor/test/lane-kinds-units.test.mjs — case tests for partitionByKind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionByKind } from '../lane-kinds.mjs';

test('empty inputs produce zero buckets', () => {
  const r = partitionByKind({}, {});
  assert.deepEqual(r.vulnerability, { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 });
  assert.deepEqual(r.posture, { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 });
  assert.deepEqual(r.unclassified, { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 });
});

test('cveTotals are added to vulnerability bucket', () => {
  const r = partitionByKind({ crit: 1, high: 2, med: 3, low: 4, undetermined: 5 }, {});
  assert.deepEqual(r.vulnerability, { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 });
});

test('scanner with known kind is added to that kind bucket', () => {
  const r = partitionByKind({}, { secrets: { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 } });
  assert.deepEqual(r.vulnerability, { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 });
});

test('scanner with unknown kind goes to unclassified', () => {
  const r = partitionByKind({}, { unknownLane: { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 } });
  assert.deepEqual(r.unclassified, { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 });
});

test('skipped scanners are not added', () => {
  const r = partitionByKind({}, { secrets: { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 } }, new Set(['secrets']));
  assert.deepEqual(r.vulnerability, { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 });
});

test('scanner with byKind splits into those kinds', () => {
  const r = partitionByKind({}, { supplyChain: { byKind: { policy: { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 } } } });
  assert.deepEqual(r.policy, { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 });
});

test('scanner with byKind containing unknown kind goes to unclassified', () => {
  const r = partitionByKind({}, { supplyChain: { byKind: { unknownKind: { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 } } } });
  assert.deepEqual(r.unclassified, { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 });
});
