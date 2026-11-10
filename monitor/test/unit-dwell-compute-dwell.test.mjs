// Computes blind, knowable, and open exposure days for a finding (monitor/dwell.mjs computeDwell).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDwell } from '../dwell.mjs';

test('computes exposure days for a closed finding with explicit dates', () => {
  const rec = {
    bugIntroducedDate: '2024-01-01T00:00:00Z',
    bugInitialReport: '2024-01-02T00:00:00Z',
    bugSquashedOn: '2024-01-05T00:00:00Z',
  };
  const r = computeDwell(rec, new Map(), '2024-01-10T00:00:00Z');
  assert.deepEqual(r, { blindExposureDays: 4, knowableExposureDays: 3, openAgeDays: 0, computedFrom: "dates" });
});

test('computes exposure days for an open finding with explicit report date', () => {
  const rec = {
    bugIntroducedDate: '2024-01-01T00:00:00Z',
    bugInitialReport: '2024-01-02T00:00:00Z',
  };
  const r = computeDwell(rec, new Map(), '2024-01-10T00:00:00Z');
  assert.deepEqual(r, { blindExposureDays: 9, knowableExposureDays: 8, openAgeDays: 8, computedFrom: "slices" });
});

test('resolves squashed date from resolved slice when no explicit date', () => {
  const rec = {
    bugIntroducedDate: '2024-01-01T00:00:00Z',
    bugInitialReport: '2024-01-02T00:00:00Z',
    resolvedSlice: 'sweep-20240105000000',
  };
  const idx = new Map([['20240105000000', '2024-01-05T00:00:00Z']]);
  const r = computeDwell(rec, idx, '2024-01-10T00:00:00Z');
  assert.deepEqual(r, { blindExposureDays: 4, knowableExposureDays: 3, openAgeDays: 0, computedFrom: "detection-bounded" });
});

test('resolves report date from born slice when no explicit report date', () => {
  const rec = {
    bornSlice: 'sweep-20240102000000',
    bugSquashedOn: '2024-01-05T00:00:00Z',
  };
  const idx = new Map([['20240102000000', '2024-01-02T00:00:00Z']]);
  const r = computeDwell(rec, idx, '2024-01-10T00:00:00Z');
  assert.deepEqual(r, { blindExposureDays: null, knowableExposureDays: 3, openAgeDays: 0, computedFrom: "dates" });
});

test('returns null for blind exposure when no introduced date', () => {
  const rec = {
    bugInitialReport: '2024-01-02T00:00:00Z',
    bugSquashedOn: '2024-01-05T00:00:00Z',
  };
  const r = computeDwell(rec, new Map(), '2024-01-10T00:00:00Z');
  assert.deepEqual(r, { blindExposureDays: null, knowableExposureDays: 3, openAgeDays: 0, computedFrom: "dates" });
});

test('returns null for knowable exposure when no report date or born slice', () => {
  const rec = {
    bugIntroducedDate: '2024-01-01T00:00:00Z',
    bugSquashedOn: '2024-01-05T00:00:00Z',
  };
  const r = computeDwell(rec, new Map(), '2024-01-10T00:00:00Z');
  assert.deepEqual(r, { blindExposureDays: 4, knowableExposureDays: null, openAgeDays: 0, computedFrom: "dates" });
});

test('returns zero open age for a closed finding', () => {
  const rec = {
    bugInitialReport: '2024-01-02T00:00:00Z',
    bugSquashedOn: '2024-01-05T00:00:00Z',
  };
  const r = computeDwell(rec, new Map(), '2024-01-10T00:00:00Z');
  assert.deepEqual(r, { blindExposureDays: null, knowableExposureDays: 3, openAgeDays: 0, computedFrom: "dates" });
});

test('returns null open age for an open finding with no report date', () => {
  const rec = {
    bugIntroducedDate: '2024-01-01T00:00:00Z',
  };
  const r = computeDwell(rec, new Map(), '2024-01-10T00:00:00Z');
  assert.deepEqual(r, { blindExposureDays: 9, knowableExposureDays: null, openAgeDays: null, computedFrom: "slices" });
});

test('uses detection-bounded source when squashed date comes from resolved slice', () => {
  const rec = {
    bugInitialReport: '2024-01-02T00:00:00Z',
    resolvedSlice: 'sweep-20240105000000',
  };
  const idx = new Map([['20240105000000', '2024-01-05T00:00:00Z']]);
  const r = computeDwell(rec, idx, '2024-01-10T00:00:00Z');
  assert.deepEqual(r, { blindExposureDays: null, knowableExposureDays: 3, openAgeDays: 0, computedFrom: "detection-bounded" });
});
