// Computes a human-readable summary of failures that are new, cleared, or persisting since the last run (bin/lib/new-since-last.mjs newSinceLastBlock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSinceLastBlock } from '../lib/new-since-last.mjs';

test('returns empty string when diff is null', () => {
  assert.equal(newSinceLastBlock(null), "");
});

test('returns empty string when diff is undefined', () => {
  assert.equal(newSinceLastBlock(undefined), "");
});

test('returns no-baseline message when status is no-baseline with persisting failures', () => {
  const diff = { status: 'no-baseline', persisting: ['a', 'b'], appeared: [], cleared: [], clearedUnknown: [] };
  assert.equal(newSinceLastBlock(diff), "\n  NEW SINCE LAST RUN: unknown \u2014 no previous run is recorded for this tree, so none of the 2 current failure(s) can be called new or old.");
});

test('returns empty string when status is no-baseline with no persisting failures', () => {
  const diff = { status: 'no-baseline', persisting: [], appeared: [], cleared: [], clearedUnknown: [] };
  assert.equal(newSinceLastBlock(diff), "");
});

test('returns empty string when appeared, cleared, and clearedUnknown are all empty', () => {
  const diff = { status: 'ok', appeared: [], cleared: [], clearedUnknown: [], persisting: ['x'], delta: 0 };
  assert.equal(newSinceLastBlock(diff), "");
});

test('returns empty string when appeared is empty but cleared is non-empty', () => {
  const diff = { status: 'ok', appeared: [], cleared: ['y'], clearedUnknown: [], persisting: [], delta: 0 };
  assert.equal(newSinceLastBlock(diff), "  CLEARED SINCE LAST RUN (1).");
});

test('returns empty string when cleared is empty but appeared is non-empty', () => {
  const diff = { status: 'ok', appeared: ['z'], cleared: [], clearedUnknown: [], persisting: [], delta: 0 };
  assert.equal(newSinceLastBlock(diff), "\n  NEW SINCE LAST RUN (1) \u2014 these were not failing at the previous measurement:\n    \u2716 z");
});

test('returns empty string when clearedUnknown is empty but appeared and cleared are non-empty', () => {
  const diff = { status: 'ok', appeared: ['a'], cleared: ['b'], clearedUnknown: [], persisting: [], delta: 0 };
  assert.equal(newSinceLastBlock(diff), "\n  NEW SINCE LAST RUN (1) \u2014 these were not failing at the previous measurement:\n    \u2716 a\n  CLEARED SINCE LAST RUN (1).");
});

test('returns empty string when appeared and cleared are empty but clearedUnknown is non-empty', () => {
  const diff = { status: 'ok', appeared: [], cleared: [], clearedUnknown: ['c'], persisting: [], delta: 0 };
  assert.equal(newSinceLastBlock(diff), "  1 previously-failing name(s) are absent, but this run covered 0 FEWER case(s) \u2014 absent is not fixed, and they are not reported as cleared.");
});

test('returns full report when appeared, cleared, clearedUnknown, and persisting are all non-empty', () => {
  const diff = { status: 'ok', appeared: ['a', 'b'], cleared: ['c'], clearedUnknown: ['d'], persisting: ['e'], delta: 1, grew: true };
  assert.equal(newSinceLastBlock(diff), "\n  NEW SINCE LAST RUN (2) \u2014 these were not failing at the previous measurement:\n    \u2716 a\n    \u2716 b\n    (this run covered 1 more case(s) than the last, so some of these may be newly RUN rather than newly broken)\n  CLEARED SINCE LAST RUN (1).\n  1 previously-failing name(s) are absent, but this run covered 1 FEWER case(s) \u2014 absent is not fixed, and they are not reported as cleared.\n  1 failure(s) were already failing last run.");
});
