// Computes per-area retention settings (monitor/retention.mjs retentionFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retentionFor } from '../retention.mjs';

test('uses global keepFullSweeps when area has no override', () => {
  const reg = { retention: { keepFullSweeps: 5 }, areas: [{ slug: 'a', retention: {} }] };
  const r = retentionFor('a', reg, { globalKeep: 2 });
  assert.deepEqual(r, { area: "a", keepFullSweeps: 2, keepDays: null, keepFrom: "global", keepDaysFrom: null, note: null });
});

test('uses area keepFullSweeps when present', () => {
  const reg = { retention: { keepFullSweeps: 5 }, areas: [{ slug: 'a', retention: { keepFullSweeps: 7 } }] };
  const r = retentionFor('a', reg, { globalKeep: 2 });
  assert.deepEqual(r, { area: "a", keepFullSweeps: 7, keepDays: null, keepFrom: "area 'a'", keepDaysFrom: null, note: null });
});

test('falls back to default when no keepFullSweeps anywhere', () => {
  const reg = { retention: {}, areas: [{ slug: 'a', retention: {} }] };
  const r = retentionFor('a', reg, {});
  assert.deepEqual(r, { area: "a", keepFullSweeps: 3, keepDays: null, keepFrom: "global", keepDaysFrom: null, note: null });
});

test('finds area by slug among multiple areas', () => {
  const reg = { retention: {}, areas: [{ slug: 'x', retention: {} }, { slug: 'y', retention: { keepFullSweeps: 9 } }] };
  const r = retentionFor('y', reg, {});
  assert.deepEqual(r, { area: "y", keepFullSweeps: 9, keepDays: null, keepFrom: "area 'y'", keepDaysFrom: null, note: null });
});

test('returns null keepDays when no keepDays defined', () => {
  const reg = { retention: {}, areas: [{ slug: 'a', retention: {} }] };
  const r = retentionFor('a', reg, {});
  assert.equal(r.keepDays, null);
});

test('uses area keepDays when present', () => {
  const reg = { retention: { keepDays: 30 }, areas: [{ slug: 'a', retention: { keepDays: 10 } }] };
  const r = retentionFor('a', reg, {});
  assert.equal(r.keepDays, 10);
});

test('uses global keepDays when area has none', () => {
  const reg = { retention: { keepDays: 30 }, areas: [{ slug: 'a', retention: {} }] };
  const r = retentionFor('a', reg, {});
  assert.equal(r.keepDays, 30);
});

test('returns null note when area has no note', () => {
  const reg = { retention: {}, areas: [{ slug: 'a', retention: {} }] };
  const r = retentionFor('a', reg, {});
  assert.equal(r.note, null);
});

test('returns area note when present', () => {
  const reg = { retention: {}, areas: [{ slug: 'a', retention: { note: 'keep for audit' } }] };
  const r = retentionFor('a', reg, {});
  assert.equal(r.note, 'keep for audit');
});

test('handles missing areas array gracefully', () => {
  const reg = { retention: { keepFullSweeps: 4 } };
  const r = retentionFor('a', reg, {});
  assert.deepEqual(r, { area: "a", keepFullSweeps: 4, keepDays: null, keepFrom: "global", keepDaysFrom: null, note: null });
});
