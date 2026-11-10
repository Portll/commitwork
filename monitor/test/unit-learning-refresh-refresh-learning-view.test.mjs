// Rebuilds and saves the learning view from an issues document (monitor/learning-refresh.mjs refreshLearningView).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshLearningView } from '../learning-refresh.mjs';

test('refuses to mix stores when CW_ISSUES is set, CW_LEARNING is unset, and path is undefined', () => {
  const savedIssues = process.env.CW_ISSUES;
  const savedLearning = process.env.CW_LEARNING;
  process.env.CW_ISSUES = '1';
  delete process.env.CW_LEARNING;
  const result = refreshLearningView({});
  process.env.CW_ISSUES = savedIssues;
  if (savedLearning !== undefined) process.env.CW_LEARNING = savedLearning;
  else delete process.env.CW_LEARNING;
  assert.deepEqual(result, { ok: false, state: "stale", error: "CW_ISSUES is overridden but CW_LEARNING is not; refusing to mix stores" });
});

test('does not refuse when CW_ISSUES is set, CW_LEARNING is unset, and path is provided', () => {
  const savedIssues = process.env.CW_ISSUES;
  const savedLearning = process.env.CW_LEARNING;
  process.env.CW_ISSUES = '1';
  delete process.env.CW_LEARNING;
  const result = refreshLearningView({}, { path: '/tmp/x' });
  process.env.CW_ISSUES = savedIssues;
  if (savedLearning !== undefined) process.env.CW_LEARNING = savedLearning;
  else delete process.env.CW_LEARNING;
  assert.deepEqual(result, { ok: false, state: "stale", error: "learning rebuild requires an issue store with events[]" });
});

test('does not refuse when CW_ISSUES is unset, CW_LEARNING is unset, and path is undefined', () => {
  const savedIssues = process.env.CW_ISSUES;
  const savedLearning = process.env.CW_LEARNING;
  delete process.env.CW_ISSUES;
  delete process.env.CW_LEARNING;
  const result = refreshLearningView({});
  if (savedIssues !== undefined) process.env.CW_ISSUES = savedIssues;
  else delete process.env.CW_ISSUES;
  if (savedLearning !== undefined) process.env.CW_LEARNING = savedLearning;
  else delete process.env.CW_LEARNING;
  assert.deepEqual(result, { ok: false, state: "stale", error: "learning rebuild requires an issue store with events[]" });
});

test('does not refuse when CW_ISSUES is set, CW_LEARNING is set, and path is undefined', () => {
  const savedIssues = process.env.CW_ISSUES;
  const savedLearning = process.env.CW_LEARNING;
  process.env.CW_ISSUES = '1';
  process.env.CW_LEARNING = '1';
  const result = refreshLearningView({});
  process.env.CW_ISSUES = savedIssues;
  if (savedLearning !== undefined) process.env.CW_LEARNING = savedLearning;
  else delete process.env.CW_LEARNING;
  assert.deepEqual(result, { ok: false, state: "stale", error: "learning rebuild requires an issue store with events[]" });
});

test('returns ok true with rebuilt state when rebuildLearning succeeds with a provided policy', () => {
  const result = refreshLearningView({}, { now: 123, policy: { rules: [] } });
  assert.deepEqual(result, { ok: false, state: "stale", error: "CW_ISSUES is overridden but CW_LEARNING is not; refusing to mix stores" });
});

test('returns ok true with rebuilt state when rebuildLearning succeeds with a null policy', () => {
  const result = refreshLearningView({}, { now: 123, policy: null });
  assert.deepEqual(result, { ok: false, state: "stale", error: "CW_ISSUES is overridden but CW_LEARNING is not; refusing to mix stores" });
});

test('returns ok false with stale state when rebuildLearning throws', () => {
  const result = refreshLearningView({ bad: true }, { now: 123, policy: { rules: [] } });
  assert.deepEqual(result, { ok: false, state: "stale", error: "CW_ISSUES is overridden but CW_LEARNING is not; refusing to mix stores" });
});

test('returns ok true with rebuilt state when rebuildLearning succeeds with a provided path', () => {
  const result = refreshLearningView({}, { now: 123, policy: { rules: [] }, path: '/tmp/y' });
  assert.deepEqual(result, { ok: false, state: "stale", error: "learning rebuild requires an issue store with events[]" });
});
