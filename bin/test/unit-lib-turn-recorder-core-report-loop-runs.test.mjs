// Detects consecutive model-authored turns that call no tool (bin/lib/turn-recorder-core.mjs reportLoopRuns).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportLoopRuns } from '../lib/turn-recorder-core.mjs';

test('returns an empty array when the input is not an array', () => {
  assert.deepEqual(reportLoopRuns(null), []);
});

test('excludes harness-authored turns from the run population', () => {
  const turns = [
    { modelAuthored: false, toolCallCount: 0, text: 'harness notice' },
    { modelAuthored: true, toolCallCount: 0, text: 'thinking' },
    { modelAuthored: false, toolCallCount: 0, text: 'another notice' },
    { modelAuthored: true, toolCallCount: 0, text: 'more thinking' },
  ];
  assert.deepEqual(reportLoopRuns(turns), [{ from: 1, to: 3, length: 2, openedByUuid: null }]);
});

test('treats a turn with a tool call as breaking a run', () => {
  const turns = [
    { modelAuthored: true, toolCallCount: 0, text: 'a' },
    { modelAuthored: true, toolCallCount: 1, text: 'b' },
    { modelAuthored: true, toolCallCount: 0, text: 'c' },
  ];
  assert.deepEqual(reportLoopRuns(turns), [{ from: 0, to: 0, length: 1, openedByUuid: null }, { from: 2, to: 2, length: 1, openedByUuid: null }]);
});

test('treats a turn with empty text as breaking a run', () => {
  const turns = [
    { modelAuthored: true, toolCallCount: 0, text: 'a' },
    { modelAuthored: true, toolCallCount: 0, text: '   ' },
    { modelAuthored: true, toolCallCount: 0, text: 'b' },
  ];
  assert.deepEqual(reportLoopRuns(turns), [{ from: 0, to: 0, length: 1, openedByUuid: null }, { from: 2, to: 2, length: 1, openedByUuid: null }]);
});

test('treats a turn with null text as breaking a run', () => {
  const turns = [
    { modelAuthored: true, toolCallCount: 0, text: 'a' },
    { modelAuthored: true, toolCallCount: 0, text: null },
    { modelAuthored: true, toolCallCount: 0, text: 'b' },
  ];
  assert.deepEqual(reportLoopRuns(turns), [{ from: 0, to: 0, length: 1, openedByUuid: null }, { from: 2, to: 2, length: 1, openedByUuid: null }]);
});

test('treats a turn with null toolCallCount as toolless when text is present', () => {
  const turns = [
    { modelAuthored: true, toolCallCount: null, text: 'a' },
    { modelAuthored: true, toolCallCount: null, text: 'b' },
  ];
  assert.deepEqual(reportLoopRuns(turns), [{ from: 0, to: 1, length: 2, openedByUuid: null }]);
});

test('treats a turn with zero toolCallCount and one-character text as toolless', () => {
  const turns = [
    { modelAuthored: true, toolCallCount: 0, text: 'x' },
    { modelAuthored: true, toolCallCount: 0, text: 'y' },
  ];
  assert.deepEqual(reportLoopRuns(turns), [{ from: 0, to: 1, length: 2, openedByUuid: null }]);
});

test('reports the original array indices for a run spanning a harness turn', () => {
  const turns = [
    { modelAuthored: true, toolCallCount: 0, text: 'a' },
    { modelAuthored: false, toolCallCount: 0, text: 'notice' },
    { modelAuthored: true, toolCallCount: 0, text: 'b' },
  ];
  assert.deepEqual(reportLoopRuns(turns), [{ from: 0, to: 2, length: 2, openedByUuid: null }]);
});

test('reports openedByUuid from the first turn of a run', () => {
  const turns = [
    { modelAuthored: true, toolCallCount: 0, text: 'a', openedByUuid: 'uuid-1' },
    { modelAuthored: true, toolCallCount: 0, text: 'b', openedByUuid: 'uuid-2' },
  ];
  assert.deepEqual(reportLoopRuns(turns), [{ from: 0, to: 1, length: 2, openedByUuid: "uuid-1" }]);
});

test('returns an empty array when every turn has a tool call', () => {
  const turns = [
    { modelAuthored: true, toolCallCount: 1, text: 'a' },
    { modelAuthored: true, toolCallCount: 2, text: 'b' },
  ];
  assert.deepEqual(reportLoopRuns(turns), []);
});
