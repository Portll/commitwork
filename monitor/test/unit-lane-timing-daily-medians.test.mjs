// Computes per-day run counts and p50/min/max latencies (monitor/lane-timing.mjs dailyMedians).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyMedians } from '../lane-timing.mjs';

test('skips samples with missing at or non-number ms', () => {
  const r = dailyMedians([
    { at: '2024-01-01T00:00:00Z', ms: 100 },
    { at: '2024-01-01T01:00:00Z', ms: '200' },
    { at: '', ms: 300 },
    { ms: 400 },
    { at: '2024-01-01T02:00:00Z', ms: 500 }
  ]);
  assert.deepEqual(r, [{ day: "2024-01-01", runs: 2, p50: 100, min: 100, max: 500 }]);
});

test('groups samples by date and sorts days ascending', () => {
  const r = dailyMedians([
    { at: '2024-01-02T00:00:00Z', ms: 10 },
    { at: '2024-01-01T00:00:00Z', ms: 20 },
    { at: '2024-01-03T00:00:00Z', ms: 30 }
  ]);
  assert.deepEqual(r, [{ day: "2024-01-01", runs: 1, p50: 20, min: 20, max: 20 }, { day: "2024-01-02", runs: 1, p50: 10, min: 10, max: 10 }, { day: "2024-01-03", runs: 1, p50: 30, min: 30, max: 30 }]);
});

test('computes p50 as median of sorted values', () => {
  const r = dailyMedians([
    { at: '2024-01-01T00:00:00Z', ms: 30 },
    { at: '2024-01-01T01:00:00Z', ms: 10 },
    { at: '2024-01-01T02:00:00Z', ms: 20 }
  ]);
  assert.deepEqual(r, [{ day: "2024-01-01", runs: 3, p50: 20, min: 10, max: 30 }]);
});

test('computes min and max from sorted values', () => {
  const r = dailyMedians([
    { at: '2024-01-01T00:00:00Z', ms: 50 },
    { at: '2024-01-01T01:00:00Z', ms: 10 },
    { at: '2024-01-01T02:00:00Z', ms: 30 }
  ]);
  assert.deepEqual(r, [{ day: "2024-01-01", runs: 3, p50: 30, min: 10, max: 50 }]);
});

test('handles single sample per day', () => {
  const r = dailyMedians([
    { at: '2024-01-01T00:00:00Z', ms: 42 }
  ]);
  assert.deepEqual(r, [{ day: "2024-01-01", runs: 1, p50: 42, min: 42, max: 42 }]);
});

test('returns empty array when all samples are invalid', () => {
  const r = dailyMedians([
    { at: '', ms: 100 },
    { ms: 200 },
    { at: '2024-01-01T00:00:00Z', ms: 'bad' }
  ]);
  assert.deepEqual(r, []);
});

test('handles multiple days with varying sample counts', () => {
  const r = dailyMedians([
    { at: '2024-01-02T00:00:00Z', ms: 100 },
    { at: '2024-01-01T00:00:00Z', ms: 50 },
    { at: '2024-01-01T01:00:00Z', ms: 30 },
    { at: '2024-01-01T02:00:00Z', ms: 70 }
  ]);
  assert.deepEqual(r, [{ day: "2024-01-01", runs: 3, p50: 50, min: 30, max: 70 }, { day: "2024-01-02", runs: 1, p50: 100, min: 100, max: 100 }]);
});

test('sorts values within a day before computing statistics', () => {
  const r = dailyMedians([
    { at: '2024-01-01T00:00:00Z', ms: 90 },
    { at: '2024-01-01T01:00:00Z', ms: 10 },
    { at: '2024-01-01T02:00:00Z', ms: 50 },
    { at: '2024-01-01T03:00:00Z', ms: 30 },
    { at: '2024-01-01T04:00:00Z', ms: 70 }
  ]);
  assert.deepEqual(r, [{ day: "2024-01-01", runs: 5, p50: 50, min: 10, max: 90 }]);
});
