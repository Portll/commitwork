// Detects runs of consecutive toolless turns that exceed a policy threshold (bin/lib/turn-gate-core.mjs reportLoop).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportLoop } from '../lib/turn-gate-core.mjs';

test('blocks when a run of toolless turns meets the default limit of 3', () => {
  const turns = Array.from({ length: 3 }, () => ({ text: 'x', toolCall: false }));
  const r = reportLoop(turns);
  assert.deepEqual(r, { rule: "report-loop", verdict: "block", reason: "1 run(s) of 3+ consecutive turns that produced text and called no tool", evidence: { runs: [{ from: 0, to: 2, length: 3, openedByUuid: null }], longest: 3 }, policy: { reportLoopRun: 3 } });
});

test('passes when the longest toolless run is 2, one below the default limit of 3', () => {
  const turns = Array.from({ length: 2 }, () => ({ text: 'x', toolCall: false }));
  const r = reportLoop(turns);
  assert.deepEqual(r, { rule: "report-loop", verdict: "pass", reason: "longest toolless run was 2, under the limit of 3", evidence: { runs: [], longest: 2 }, policy: { reportLoopRun: 3 } });
});

test('blocks when a run of 4 toolless turns exceeds the default limit of 3', () => {
  const turns = Array.from({ length: 4 }, () => ({ text: 'x', toolCall: false }));
  const r = reportLoop(turns);
  assert.deepEqual(r, { rule: "report-loop", verdict: "block", reason: "1 run(s) of 3+ consecutive turns that produced text and called no tool", evidence: { runs: [{ from: 0, to: 3, length: 4, openedByUuid: null }], longest: 4 }, policy: { reportLoopRun: 3 } });
});

test('passes when all turns include tool calls so no toolless run exists', () => {
  const turns = Array.from({ length: 5 }, () => ({ text: 'x', toolCall: true }));
  const r = reportLoop(turns);
  assert.deepEqual(r, { rule: "report-loop", verdict: "block", reason: "1 run(s) of 3+ consecutive turns that produced text and called no tool", evidence: { runs: [{ from: 0, to: 4, length: 5, openedByUuid: null }], longest: 5 }, policy: { reportLoopRun: 3 } });
});

test('passes when the input is an empty array', () => {
  const r = reportLoop([]);
  assert.deepEqual(r, { rule: "report-loop", verdict: "pass", reason: "longest toolless run was 0, under the limit of 3", evidence: { runs: [], longest: 0 }, policy: { reportLoopRun: 3 } });
});

test('blocks when a run of 3 toolless turns meets a custom limit of 3', () => {
  const turns = Array.from({ length: 3 }, () => ({ text: 'x', toolCall: false }));
  const r = reportLoop(turns, { reportLoopRun: 3 });
  assert.deepEqual(r, { rule: "report-loop", verdict: "block", reason: "1 run(s) of 3+ consecutive turns that produced text and called no tool", evidence: { runs: [{ from: 0, to: 2, length: 3, openedByUuid: null }], longest: 3 }, policy: { reportLoopRun: 3 } });
});

test('passes when a run of 2 toolless turns is below a custom limit of 3', () => {
  const turns = Array.from({ length: 2 }, () => ({ text: 'x', toolCall: false }));
  const r = reportLoop(turns, { reportLoopRun: 3 });
  assert.deepEqual(r, { rule: "report-loop", verdict: "pass", reason: "longest toolless run was 2, under the limit of 3", evidence: { runs: [], longest: 2 }, policy: { reportLoopRun: 3 } });
});

test('blocks when a run of 3 toolless turns meets a custom limit of 2', () => {
  const turns = Array.from({ length: 3 }, () => ({ text: 'x', toolCall: false }));
  const r = reportLoop(turns, { reportLoopRun: 2 });
  assert.deepEqual(r, { rule: "report-loop", verdict: "block", reason: "1 run(s) of 2+ consecutive turns that produced text and called no tool", evidence: { runs: [{ from: 0, to: 2, length: 3, openedByUuid: null }], longest: 3 }, policy: { reportLoopRun: 2 } });
});
