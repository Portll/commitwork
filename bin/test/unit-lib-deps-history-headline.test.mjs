// Computes lifecycle summary stats (bin/lib/deps-history.mjs headline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headline } from '../lib/deps-history.mjs';

test('empty lifecycle returns zero counts and null medians', () => {
  const r = headline([]);
  assert.deepEqual(r, { releases: 0, applied: 0, open: 0, held: 0, medianFindDays: null, medianApplyDays: null, medianApplyDaysByType: { patch: null, minor: null, major: null }, patchWithin: { "7": { applied: 0, of: 0 }, "30": { applied: 0, of: 0 } }, oldestOpen: null, byMerge: 0, byObserved: 0, backlog: { releases: 0, applied: 0, open: 0 } });
});

test('applied patch within 7 days counts correctly', () => {
  const now = Date.parse('2024-01-10T00:00:00Z');
  const r = headline([
    { type: 'patch', publishedAt: '2024-01-01T00:00:00Z', appliedAt: '2024-01-03T00:00:00Z', applyLagDays: 2, appliedBy: 'merge' }
  ], { nowMs: now });
  assert.deepEqual(r, { releases: 1, applied: 1, open: 0, held: 0, medianFindDays: null, medianApplyDays: 2, medianApplyDaysByType: { patch: 2, minor: null, major: null }, patchWithin: { "7": { applied: 1, of: 1 }, "30": { applied: 0, of: 0 } }, oldestOpen: null, byMerge: 1, byObserved: 0, backlog: { releases: 0, applied: 0, open: 0 } });
});

test('applied patch exactly at 7 day boundary is included', () => {
  const now = Date.parse('2024-01-10T00:00:00Z');
  const r = headline([
    { type: 'patch', publishedAt: '2024-01-03T00:00:00Z', appliedAt: '2024-01-10T00:00:00Z', applyLagDays: 7, appliedBy: 'observed' }
  ], { nowMs: now });
  assert.deepEqual(r, { releases: 1, applied: 1, open: 0, held: 0, medianFindDays: null, medianApplyDays: 7, medianApplyDaysByType: { patch: 7, minor: null, major: null }, patchWithin: { "7": { applied: 1, of: 1 }, "30": { applied: 0, of: 0 } }, oldestOpen: null, byMerge: 0, byObserved: 1, backlog: { releases: 0, applied: 0, open: 0 } });
});

test('applied patch just past 7 day boundary is excluded from within 7', () => {
  const now = Date.parse('2024-01-10T00:00:00Z');
  const r = headline([
    { type: 'patch', publishedAt: '2024-01-02T23:59:59Z', appliedAt: '2024-01-10T00:00:00Z', applyLagDays: 8, appliedBy: 'merge' }
  ], { nowMs: now });
  assert.deepEqual(r, { releases: 1, applied: 1, open: 0, held: 0, medianFindDays: null, medianApplyDays: 8, medianApplyDaysByType: { patch: 8, minor: null, major: null }, patchWithin: { "7": { applied: 0, of: 1 }, "30": { applied: 0, of: 0 } }, oldestOpen: null, byMerge: 1, byObserved: 0, backlog: { releases: 0, applied: 0, open: 0 } });
});

test('open release with eligibleAt is counted as open', () => {
  const now = Date.parse('2024-01-10T00:00:00Z');
  const r = headline([
    { type: 'minor', publishedAt: '2024-01-01T00:00:00Z', eligibleAt: '2024-01-05T00:00:00Z', openDays: 5, name: 'pkg', version: '1.0.0' }
  ], { nowMs: now });
  assert.deepEqual(r, { releases: 1, applied: 0, open: 1, held: 0, medianFindDays: null, medianApplyDays: null, medianApplyDaysByType: { patch: null, minor: null, major: null }, patchWithin: { "7": { applied: 0, of: 0 }, "30": { applied: 0, of: 0 } }, oldestOpen: { name: "pkg", version: "1.0.0", type: "minor", days: 5 }, byMerge: 0, byObserved: 0, backlog: { releases: 0, applied: 0, open: 0 } });
});

test('held release without eligibleAt is counted as held', () => {
  const now = Date.parse('2024-01-10T00:00:00Z');
  const r = headline([
    { type: 'major', publishedAt: '2024-01-01T00:00:00Z', name: 'pkg', version: '2.0.0' }
  ], { nowMs: now });
  assert.deepEqual(r, { releases: 1, applied: 0, open: 0, held: 1, medianFindDays: null, medianApplyDays: null, medianApplyDaysByType: { patch: null, minor: null, major: null }, patchWithin: { "7": { applied: 0, of: 0 }, "30": { applied: 0, of: 0 } }, oldestOpen: null, byMerge: 0, byObserved: 0, backlog: { releases: 0, applied: 0, open: 0 } });
});

test('preexisting releases are separated into backlog', () => {
  const now = Date.parse('2024-01-10T00:00:00Z');
  const r = headline([
    { type: 'patch', preexisting: true, publishedAt: '2024-01-01T00:00:00Z', appliedAt: '2024-01-02T00:00:00Z', applyLagDays: 1, appliedBy: 'merge' },
    { type: 'patch', preexisting: true, publishedAt: '2024-01-01T00:00:00Z', eligibleAt: '2024-01-05T00:00:00Z', openDays: 3, name: 'old', version: '0.9.0' }
  ], { nowMs: now });
  assert.deepEqual(r, { releases: 0, applied: 0, open: 0, held: 0, medianFindDays: null, medianApplyDays: null, medianApplyDaysByType: { patch: null, minor: null, major: null }, patchWithin: { "7": { applied: 0, of: 0 }, "30": { applied: 0, of: 0 } }, oldestOpen: null, byMerge: 0, byObserved: 0, backlog: { releases: 2, applied: 1, open: 1 } });
});

test('oldest open release is selected by maximum openDays', () => {
  const now = Date.parse('2024-01-10T00:00:00Z');
  const r = headline([
    { type: 'minor', publishedAt: '2024-01-01T00:00:00Z', eligibleAt: '2024-01-05T00:00:00Z', openDays: 3, name: 'a', version: '1.0.0' },
    { type: 'patch', publishedAt: '2024-01-01T00:00:00Z', eligibleAt: '2024-01-05T00:00:00Z', openDays: 10, name: 'b', version: '1.1.0' },
    { type: 'major', publishedAt: '2024-01-01T00:00:00Z', eligibleAt: '2024-01-05T00:00:00Z', openDays: 7, name: 'c', version: '2.0.0' }
  ], { nowMs: now });
  assert.deepEqual(r, { releases: 3, applied: 0, open: 3, held: 0, medianFindDays: null, medianApplyDays: null, medianApplyDaysByType: { patch: null, minor: null, major: null }, patchWithin: { "7": { applied: 0, of: 1 }, "30": { applied: 0, of: 0 } }, oldestOpen: { name: "b", version: "1.1.0", type: "patch", days: 10 }, byMerge: 0, byObserved: 0, backlog: { releases: 0, applied: 0, open: 0 } });
});

test('median apply days by type is computed for each type', () => {
  const now = Date.parse('2024-01-10T00:00:00Z');
  const r = headline([
    { type: 'patch', publishedAt: '2024-01-01T00:00:00Z', appliedAt: '2024-01-03T00:00:00Z', applyLagDays: 2, appliedBy: 'merge' },
    { type: 'minor', publishedAt: '2024-01-01T00:00:00Z', appliedAt: '2024-01-05T00:00:00Z', applyLagDays: 4, appliedBy: 'observed' },
    { type: 'major', publishedAt: '2024-01-01T00:00:00Z', appliedAt: '2024-01-08T00:00:00Z', applyLagDays: 7, appliedBy: 'merge' }
  ], { nowMs: now });
  assert.deepEqual(r, { releases: 3, applied: 3, open: 0, held: 0, medianFindDays: null, medianApplyDays: 4, medianApplyDaysByType: { patch: 2, minor: 4, major: 7 }, patchWithin: { "7": { applied: 1, of: 1 }, "30": { applied: 0, of: 0 } }, oldestOpen: null, byMerge: 2, byObserved: 1, backlog: { releases: 0, applied: 0, open: 0 } });
});

test('null applyLagDays is excluded from within-days applied count', () => {
  const now = Date.parse('2024-01-10T00:00:00Z');
  const r = headline([
    { type: 'patch', publishedAt: '2024-01-01T00:00:00Z', appliedAt: '2024-01-03T00:00:00Z', applyLagDays: null, appliedBy: 'merge' }
  ], { nowMs: now });
  assert.deepEqual(r, { releases: 1, applied: 1, open: 0, held: 0, medianFindDays: null, medianApplyDays: null, medianApplyDaysByType: { patch: null, minor: null, major: null }, patchWithin: { "7": { applied: 0, of: 1 }, "30": { applied: 0, of: 0 } }, oldestOpen: null, byMerge: 1, byObserved: 0, backlog: { releases: 0, applied: 0, open: 0 } });
});
