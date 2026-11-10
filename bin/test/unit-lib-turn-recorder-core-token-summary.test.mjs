// Per-turn token usage, tool-less share, cache ratio, and output-per-turn (bin/lib/turn-recorder-core.mjs tokenSummary).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenSummary } from '../lib/turn-recorder-core.mjs';

test('excludes harness-authored turns from the counted list', () => {
  const r = tokenSummary([
    { modelAuthored: false, tokens: { input: 1, output: 1, cacheRead: 1, cacheCreation: 1, thinking: 1 }, toolCallCount: 0, text: 'x' },
    { modelAuthored: true, tokens: { input: 2, output: 2, cacheRead: 2, cacheCreation: 2, thinking: 2 }, toolCallCount: 1, text: 'y' },
  ]);
  assert.deepEqual(r, { turns: 1, syntheticTurns: 1, turnsWithoutTools: 0, turnsWithoutUsage: 0, totals: { input: 2, output: 2, cacheRead: 2, cacheCreation: 2, thinking: 2 }, ruminationShare: null, cacheHitRatio: 0.3333333333333333, outputPerTurn: 2 });
});

test('counts turns with no tools and non-empty text as toolless', () => {
  const r = tokenSummary([
    { tokens: { input: 1, output: 1, cacheRead: 1, cacheCreation: 1, thinking: 1 }, toolCallCount: 0, text: 'hi' },
    { tokens: { input: 2, output: 2, cacheRead: 2, cacheCreation: 2, thinking: 2 }, toolCallCount: 1, text: 'yo' },
  ]);
  assert.deepEqual(r, { turns: 2, syntheticTurns: 0, turnsWithoutTools: 1, turnsWithoutUsage: 0, totals: { input: 3, output: 3, cacheRead: 3, cacheCreation: 3, thinking: 3 }, ruminationShare: 0.3333333333333333, cacheHitRatio: 0.3333333333333333, outputPerTurn: 1.5 });
});

test('treats missing toolCallCount as zero for the toolless filter', () => {
  const r = tokenSummary([
    { tokens: { input: 1, output: 1, cacheRead: 1, cacheCreation: 1, thinking: 1 }, text: 'a' },
    { tokens: { input: 2, output: 2, cacheRead: 2, cacheCreation: 2, thinking: 2 }, toolCallCount: 0, text: '   ' },
  ]);
  assert.deepEqual(r, { turns: 2, syntheticTurns: 0, turnsWithoutTools: 1, turnsWithoutUsage: 0, totals: { input: 3, output: 3, cacheRead: 3, cacheCreation: 3, thinking: 3 }, ruminationShare: 0.3333333333333333, cacheHitRatio: 0.3333333333333333, outputPerTurn: 1.5 });
});

test('counts turns whose tokens object has a null output as tokenless', () => {
  const r = tokenSummary([
    { tokens: { input: 1, output: null, cacheRead: 1, cacheCreation: 1, thinking: 1 }, toolCallCount: 1, text: 'a' },
    { tokens: { input: 2, output: 2, cacheRead: 2, cacheCreation: 2, thinking: 2 }, toolCallCount: 1, text: 'b' },
  ]);
  assert.deepEqual(r, { turns: 2, syntheticTurns: 0, turnsWithoutTools: 0, turnsWithoutUsage: 1, totals: { input: 3, output: 2, cacheRead: 3, cacheCreation: 3, thinking: 3 }, ruminationShare: null, cacheHitRatio: 0.3333333333333333, outputPerTurn: 1 });
});

test('returns null for ratios whose denominator is zero', () => {
  const r = tokenSummary([
    { tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, thinking: 0 }, toolCallCount: 1, text: 'a' },
  ]);
  assert.deepEqual(r, { turns: 1, syntheticTurns: 0, turnsWithoutTools: 0, turnsWithoutUsage: 0, totals: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, thinking: 0 }, ruminationShare: null, cacheHitRatio: null, outputPerTurn: 0 });
});

test('returns null for ratios whose numerator is null', () => {
  const r = tokenSummary([
    { tokens: { input: 5, output: null, cacheRead: null, cacheCreation: null, thinking: null }, toolCallCount: 1, text: 'a' },
  ]);
  assert.deepEqual(r, { turns: 1, syntheticTurns: 0, turnsWithoutTools: 0, turnsWithoutUsage: 1, totals: { input: 5, output: null, cacheRead: null, cacheCreation: null, thinking: null }, ruminationShare: null, cacheHitRatio: null, outputPerTurn: null });
});

test('computes cacheHitRatio over the charged input total', () => {
  const r = tokenSummary([
    { tokens: { input: 10, output: 20, cacheRead: 5, cacheCreation: 3, thinking: 1 }, toolCallCount: 1, text: 'a' },
  ]);
  assert.deepEqual(r, { turns: 1, syntheticTurns: 0, turnsWithoutTools: 0, turnsWithoutUsage: 0, totals: { input: 10, output: 20, cacheRead: 5, cacheCreation: 3, thinking: 1 }, ruminationShare: null, cacheHitRatio: 0.2777777777777778, outputPerTurn: 20 });
});

test('returns an empty summary for a non-array input', () => {
  const r = tokenSummary(null);
  assert.deepEqual(r, { turns: 0, syntheticTurns: 0, turnsWithoutTools: 0, turnsWithoutUsage: 0, totals: { input: null, output: null, cacheRead: null, cacheCreation: null, thinking: null }, ruminationShare: null, cacheHitRatio: null, outputPerTurn: null });
});
