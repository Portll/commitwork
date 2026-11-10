// Computes the undetermined share of a lane's findings from rollups (monitor/lane-trust.mjs undeterminedColumn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { undeterminedColumn } from '../lane-trust.mjs';

test('returns not-measured when fleet state is not read', () => {
  const fleet = { state: 'unread', why: 'no data' };
  const r = undeterminedColumn('crit', fleet);
  assert.deepEqual(r, { state: "not-measured", why: "no data" });
});

test('returns not-measured when readBy is provided', () => {
  const fleet = { state: 'read', rollups: [] };
  const r = undeterminedColumn('crit', fleet, 'main');
  assert.deepEqual(r, { state: "not-measured", why: "the rollup carries no scanners bucket for this lane; its findings reach main" });
});

test('returns not-measured when unread is provided', () => {
  const fleet = { state: 'read', rollups: [] };
  const r = undeterminedColumn('crit', fleet, null, 'no reader');
  assert.deepEqual(r, { state: "not-measured", why: "the rollup carries no scanners bucket for this lane, and no report reads its findings: no reader" });
});

test('returns not-measured when no rollup carries the lane', () => {
  const fleet = { state: 'read', rollups: [{ scanners: { other: { crit: 1 } } }] };
  const r = undeterminedColumn('crit', fleet);
  assert.deepEqual(r, { state: "not-measured", why: "no rollup carries this lane" });
});

test('returns not-measured with areas when lane published no findings', () => {
  const fleet = { state: 'read', rollups: [{ scanners: { crit: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } } }] };
  const r = undeterminedColumn('crit', fleet);
  assert.deepEqual(r, { state: "not-measured", why: "the lane published no findings, so no share exists", areas: 1 });
});

test('returns measured with share when findings exist', () => {
  const fleet = { state: 'read', rollups: [{ scanners: { crit: { crit: 2, high: 1, med: 0, low: 0, undetermined: 3 } } }] };
  const r = undeterminedColumn('crit', fleet);
  assert.deepEqual(r, { state: "measured", undetermined: 3, graded: 3, of: 6, share: 0.5, areas: 1 });
});

test('returns unreadable when a count is negative', () => {
  const fleet = { state: 'read', rollups: [{ scanners: { crit: { crit: -1, high: 0, med: 0, low: 0, undetermined: 0 } } }] };
  const r = undeterminedColumn('crit', fleet);
  assert.deepEqual(r, { state: "unreadable", why: "a rollup carries a non-count crit for this lane" });
});

test('returns unreadable when a count is non-numeric', () => {
  const fleet = { state: 'read', rollups: [{ scanners: { crit: { crit: 'x', high: 0, med: 0, low: 0, undetermined: 0 } } }] };
  const r = undeterminedColumn('crit', fleet);
  assert.deepEqual(r, { state: "unreadable", why: "a rollup carries a non-count crit for this lane" });
});

test('handles multiple rollups accumulating counts', () => {
  const fleet = { state: 'read', rollups: [
    { scanners: { crit: { crit: 1, high: 1, med: 0, low: 0, undetermined: 1 } } },
    { scanners: { crit: { crit: 2, high: 0, med: 1, low: 0, undetermined: 2 } } }
  ]};
  const r = undeterminedColumn('crit', fleet);
  assert.deepEqual(r, { state: "measured", undetermined: 3, graded: 5, of: 8, share: 0.375, areas: 2 });
});

test('skips rollups without scanners object', () => {
  const fleet = { state: 'read', rollups: [
    { scanners: { crit: { crit: 1, high: 0, med: 0, low: 0, undetermined: 1 } } },
    { other: true }
  ]};
  const r = undeterminedColumn('crit', fleet);
  assert.deepEqual(r, { state: "measured", undetermined: 1, graded: 1, of: 2, share: 0.5, areas: 1 });
});
