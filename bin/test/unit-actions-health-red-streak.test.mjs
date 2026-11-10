// Count of consecutive red runs from newest until first green (bin/actions-health.mjs redStreak).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redStreak } from '../actions-health.mjs';

test('returns zero length and null since for empty input', () => {
  const result = redStreak([]);
  assert.deepEqual(result, { length: 0, since: null });
});

test('returns zero length and null since when newest run is green', () => {
  const runs = [
    { conclusion: 'success', created_at: '2024-01-01T00:00:00Z' },
    { conclusion: 'failure', created_at: '2024-01-02T00:00:00Z' },
  ];
  const result = redStreak(runs);
  assert.deepEqual(result, { length: 0, since: null });
});

test('counts one red run when newest is failure', () => {
  const runs = [
    { conclusion: 'failure', created_at: '2024-01-01T00:00:00Z' },
  ];
  const result = redStreak(runs);
  assert.deepEqual(result, { length: 1, since: '2024-01-01T00:00:00Z' });
});

test('counts multiple consecutive red runs', () => {
  const runs = [
    { conclusion: 'failure', created_at: '2024-01-03T00:00:00Z' },
    { conclusion: 'timed_out', created_at: '2024-01-02T00:00:00Z' },
    { conclusion: 'startup_failure', created_at: '2024-01-01T00:00:00Z' },
  ];
  const result = redStreak(runs);
  assert.deepEqual(result, { length: 3, since: '2024-01-01T00:00:00Z' });
});

test('stops counting at first green run in the middle', () => {
  const runs = [
    { conclusion: 'failure', created_at: '2024-01-03T00:00:00Z' },
    { conclusion: 'success', created_at: '2024-01-02T00:00:00Z' },
    { conclusion: 'failure', created_at: '2024-01-01T00:00:00Z' },
  ];
  const result = redStreak(runs);
  assert.deepEqual(result, { length: 1, since: '2024-01-03T00:00:00Z' });
});

test('skips non-red non-green conclusions and continues counting', () => {
  const runs = [
    { conclusion: 'failure', created_at: '2024-01-03T00:00:00Z' },
    { conclusion: 'skipped', created_at: '2024-01-02T00:00:00Z' },
    { conclusion: 'timed_out', created_at: '2024-01-01T00:00:00Z' },
  ];
  const result = redStreak(runs);
  assert.deepEqual(result, { length: 2, since: '2024-01-01T00:00:00Z' });
});

test('returns zero length when all runs are non-red non-green', () => {
  const runs = [
    { conclusion: 'skipped', created_at: '2024-01-02T00:00:00Z' },
    { conclusion: 'cancelled', created_at: '2024-01-01T00:00:00Z' },
  ];
  const result = redStreak(runs);
  assert.deepEqual(result, { length: 0, since: null });
});

test('handles all red runs without any green', () => {
  const runs = Array.from({ length: 5 }, (_, i) => ({
    conclusion: 'failure',
    created_at: `2024-01-0${i + 1}T00:00:00Z`,
  }));
  const result = redStreak(runs);
  assert.deepEqual(result, { length: 5, since: "2024-01-05T00:00:00Z" });
});
