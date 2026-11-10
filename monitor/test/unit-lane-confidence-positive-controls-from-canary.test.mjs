// Computes per-lane positive control summaries from a canary scan (monitor/lane-confidence.mjs positiveControlsFromCanary).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positiveControlsFromCanary } from '../lane-confidence.mjs';

test('returns read false and empty lanes when canary is null', () => {
  assert.deepEqual(positiveControlsFromCanary(null), { source: "scan-canary", read: false, lanes: {} });
});

test('returns read false and empty lanes when canary read is false', () => {
  assert.deepEqual(positiveControlsFromCanary({ read: false }), { source: "scan-canary", read: false, lanes: {} });
});

test('returns read true with empty lanes when byCategory is missing', () => {
  assert.deepEqual(positiveControlsFromCanary({ read: true, date: '2024-01-01' }), { source: "scan-canary", read: true, date: "2024-01-01", lanes: {} });
});

test('returns read true with empty lanes when byCategory is null', () => {
  assert.deepEqual(positiveControlsFromCanary({ read: true, date: '2024-01-01', byCategory: null }), { source: "scan-canary", read: true, date: "2024-01-01", lanes: {} });
});

test('returns read true with empty lanes when byCategory is empty object', () => {
  assert.deepEqual(positiveControlsFromCanary({ read: true, date: '2024-01-01', byCategory: {} }), { source: "scan-canary", read: true, date: "2024-01-01", lanes: {} });
});

test('selects latest by date and marks detected when credits present', () => {
  const canary = {
    read: true,
    date: '2024-01-01',
    byCategory: {
      alpha: [
        { date: '2024-01-02', lane: 'alpha', credits: 1, verdict: 'pass' },
        { date: '2024-01-01', lane: 'alpha', credits: 0, verdict: 'fail' }
      ]
    }
  };
  assert.deepEqual(positiveControlsFromCanary(canary), { source: "scan-canary", read: true, date: "2024-01-01", lanes: { alpha: { ranAt: "2024-01-02", outcome: "detected", verdict: "pass" } } });
});

test('selects latest by date and marks missed when credits absent', () => {
  const canary = {
    read: true,
    date: '2024-01-01',
    byCategory: {
      beta: [
        { date: '2024-01-03', lane: 'beta', credits: 0, verdict: 'fail' },
        { date: '2024-01-02', lane: 'beta', credits: 1, verdict: 'pass' }
      ]
    }
  };
  assert.deepEqual(positiveControlsFromCanary(canary), { source: "scan-canary", read: true, date: "2024-01-01", lanes: { beta: { ranAt: "2024-01-03", outcome: "missed", verdict: "fail" } } });
});

test('breaks date ties by lane name ascending', () => {
  const canary = {
    read: true,
    date: '2024-01-01',
    byCategory: {
      gamma: [
        { date: '2024-01-01', lane: 'zeta', credits: 1, verdict: 'pass' },
        { date: '2024-01-01', lane: 'alpha', credits: 0, verdict: 'fail' }
      ]
    }
  };
  assert.deepEqual(positiveControlsFromCanary(canary), { source: "scan-canary", read: true, date: "2024-01-01", lanes: { gamma: { ranAt: "2024-01-01", outcome: "missed", verdict: "fail" } } });
});

test('sets ranAt to null and verdict to null when date and verdict are missing', () => {
  const canary = {
    read: true,
    date: '2024-01-01',
    byCategory: {
      delta: [
        { lane: 'delta', credits: 1 }
      ]
    }
  };
  assert.deepEqual(positiveControlsFromCanary(canary), { source: "scan-canary", read: true, date: "2024-01-01", lanes: { delta: { ranAt: null, outcome: "detected", verdict: null } } });
});

test('sorts multiple lanes alphabetically in output', () => {
  const canary = {
    read: true,
    date: '2024-01-01',
    byCategory: {
      zeta: [{ date: '2024-01-05', lane: 'zeta', credits: 1, verdict: 'pass' }],
      alpha: [{ date: '2024-01-04', lane: 'alpha', credits: 0, verdict: 'fail' }]
    }
  };
  assert.deepEqual(positiveControlsFromCanary(canary), { source: "scan-canary", read: true, date: "2024-01-01", lanes: { alpha: { ranAt: "2024-01-04", outcome: "missed", verdict: "fail" }, zeta: { ranAt: "2024-01-05", outcome: "detected", verdict: "pass" } } });
});
