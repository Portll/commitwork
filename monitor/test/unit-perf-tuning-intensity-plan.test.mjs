// Maps an intensity score to a graded plan with a timeout factor (monitor/perf-tuning.mjs intensityPlan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intensityPlan } from '../perf-tuning.mjs';

test('returns n/a when intensityLadder is missing', () => {
  const r = intensityPlan({}, 1);
  assert.deepEqual(r, { kind: "n/a", level: null, ladder: null, timeoutFactor: 1.5 });
});

test('returns n/a when intensityLadder is a single element', () => {
  const r = intensityPlan({ intensityLadder: ['low'] }, 3);
  assert.deepEqual(r, { kind: "n/a", level: null, ladder: null, timeoutFactor: 1 });
});

test('returns n/a when intensityLadder is not an array', () => {
  const r = intensityPlan({ intensityLadder: 'low' }, 2);
  assert.deepEqual(r, { kind: "n/a", level: null, ladder: null, timeoutFactor: 1.5 });
});

test('returns graded plan with timeout factor 1.5 for intensity 2', () => {
  const r = intensityPlan({ intensityLadder: ['low', 'mid', 'high'] }, 2);
  assert.deepEqual(r, { kind: "graded", level: { rank: 2, of: 3, label: "mid" }, ladder: ["low", "mid", "high"], timeoutFactor: 1.5 });
});

test('returns graded plan with timeout factor 1 for intensity 3', () => {
  const r = intensityPlan({ intensityLadder: ['low', 'mid', 'high'] }, 3);
  assert.deepEqual(r, { kind: "graded", level: { rank: 2, of: 3, label: "mid" }, ladder: ["low", "mid", "high"], timeoutFactor: 1 });
});

test('returns graded plan with timeout factor 1.5 for intensity 1', () => {
  const r = intensityPlan({ intensityLadder: ['low', 'mid', 'high'] }, 1);
  assert.deepEqual(r, { kind: "graded", level: { rank: 1, of: 3, label: "low" }, ladder: ["low", "mid", "high"], timeoutFactor: 1.5 });
});

test('returns graded plan with timeout factor 1 for intensity 5', () => {
  const r = intensityPlan({ intensityLadder: ['low', 'mid', 'high'] }, 5);
  assert.deepEqual(r, { kind: "graded", level: { rank: 3, of: 3, label: "high" }, ladder: ["low", "mid", "high"], timeoutFactor: 1 });
});

test('returns graded plan with timeout factor 1.5 for intensity 0', () => {
  const r = intensityPlan({ intensityLadder: ['low', 'mid', 'high'] }, 0);
  assert.deepEqual(r, { kind: "graded", level: { rank: 1, of: 3, label: "low" }, ladder: ["low", "mid", "high"], timeoutFactor: 1.5 });
});
