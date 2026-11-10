// Computes the depth plan (kind, minDepth, from, gated, on, level, ladder) for a scan (monitor/perf-tuning.mjs depthPlan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depthPlan } from '../perf-tuning.mjs';

test('returns n/a kind with null level when minDepth is 1 and no ladder', () => {
  const s = { cost: 'c', minDepth: 1 };
  const doc = { costClasses: { c: { minDepth: 1 } } };
  const r = depthPlan(s, doc, 5, 'auto');
  assert.deepEqual(r, { kind: "n/a", minDepth: 1, from: 1, gated: false, on: true, level: null, ladder: null });
});

test('returns binary kind with on level when minDepth exceeds depth', () => {
  const s = { cost: 'c', minDepth: 3 };
  const doc = { costClasses: { c: { minDepth: 3 } } };
  const r = depthPlan(s, doc, 2, 'auto');
  assert.deepEqual(r, { kind: "binary", minDepth: 3, from: 3, gated: true, on: false, level: { rank: 0, of: 1, label: "off" }, ladder: null });
});

test('returns binary kind with off level when depth equals minDepth', () => {
  const s = { cost: 'c', minDepth: 3 };
  const doc = { costClasses: { c: { minDepth: 3 } } };
  const r = depthPlan(s, doc, 3, 'auto');
  assert.deepEqual(r, { kind: "binary", minDepth: 3, from: 3, gated: false, on: true, level: { rank: 1, of: 1, label: "on" }, ladder: null });
});

test('returns graded kind with rank 1 when depth equals from', () => {
  const s = { cost: 'c', minDepth: 2, depthLadder: ['a', 'b', 'c'] };
  const doc = { costClasses: { c: { minDepth: 2 } } };
  const r = depthPlan(s, doc, 2, 'auto');
  assert.deepEqual(r, { kind: "graded", minDepth: 2, from: 2, gated: false, on: true, level: { rank: 1, of: 3, label: "a" }, ladder: ["a", "b", "c"] });
});

test('returns graded kind with rank 3 when depth equals to', () => {
  const s = { cost: 'c', minDepth: 2, depthLadder: ['a', 'b', 'c'] };
  const doc = { costClasses: { c: { minDepth: 2 } } };
  const r = depthPlan(s, doc, 5, 'auto');
  assert.deepEqual(r, { kind: "graded", minDepth: 2, from: 2, gated: false, on: true, level: { rank: 3, of: 3, label: "c" }, ladder: ["a", "b", "c"] });
});

test('returns graded kind with rank 2 when depth is midpoint', () => {
  const s = { cost: 'c', minDepth: 2, depthLadder: ['a', 'b', 'c'] };
  const doc = { costClasses: { c: { minDepth: 2 } } };
  const r = depthPlan(s, doc, 3, 'auto');
  assert.deepEqual(r, { kind: "graded", minDepth: 2, from: 2, gated: false, on: true, level: { rank: 2, of: 3, label: "b" }, ladder: ["a", "b", "c"] });
});

test('returns graded kind with rank 0 when override is off', () => {
  const s = { cost: 'c', minDepth: 2, depthLadder: ['a', 'b', 'c'] };
  const doc = { costClasses: { c: { minDepth: 2 } } };
  const r = depthPlan(s, doc, 5, 'off');
  assert.deepEqual(r, { kind: "graded", minDepth: 2, from: 2, gated: false, on: false, level: { rank: 0, of: 3, label: "off" }, ladder: ["a", "b", "c"] });
});

test('returns graded kind with rank 1 when override is on and gated', () => {
  const s = { cost: 'c', minDepth: 5, depthLadder: ['a', 'b', 'c'] };
  const doc = { costClasses: { c: { minDepth: 5 } } };
  const r = depthPlan(s, doc, 2, 'on');
  assert.deepEqual(r, { kind: "graded", minDepth: 5, from: 5, gated: true, on: true, level: { rank: 3, of: 3, label: "c" }, ladder: ["a", "b", "c"] });
});

test('returns binary kind with on level when override is on and gated', () => {
  const s = { cost: 'c', minDepth: 3 };
  const doc = { costClasses: { c: { minDepth: 3 } } };
  const r = depthPlan(s, doc, 2, 'on');
  assert.deepEqual(r, { kind: "binary", minDepth: 3, from: 3, gated: true, on: true, level: { rank: 1, of: 1, label: "on" }, ladder: null });
});

test('returns binary kind with off level when override is off and not gated', () => {
  const s = { cost: 'c', minDepth: 3 };
  const doc = { costClasses: { c: { minDepth: 3 } } };
  const r = depthPlan(s, doc, 5, 'off');
  assert.deepEqual(r, { kind: "binary", minDepth: 3, from: 3, gated: false, on: false, level: { rank: 0, of: 1, label: "off" }, ladder: null });
});
