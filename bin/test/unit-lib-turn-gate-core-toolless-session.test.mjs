// Detects sessions with many model turns but no tool calls (bin/lib/turn-gate-core.mjs toollessSession).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toollessSession } from '../lib/turn-gate-core.mjs';

test('returns unknown verdict when no model-authored turns exist', () => {
  const r = toollessSession([]);
  assert.deepEqual(r, { rule: "toolless-session", verdict: "unknown", reason: "no model-authored turns to judge", evidence: { modelTurns: 0, toolCalls: 0 }, policy: { toollessSessionTurns: 5 } });
});

test('returns unknown verdict when all turns are harness-authored', () => {
  const turns = [
    { modelAuthored: false, toolCallCount: 5 },
    { modelAuthored: false, toolCallCount: 3 },
  ];
  const r = toollessSession(turns);
  assert.deepEqual(r, { rule: "toolless-session", verdict: "unknown", reason: "no model-authored turns to judge", evidence: { modelTurns: 0, toolCalls: 0 }, policy: { toollessSessionTurns: 5 } });
});

test('returns unknown verdict when input is not an array', () => {
  const r = toollessSession(null);
  assert.deepEqual(r, { rule: "toolless-session", verdict: "unknown", reason: "no model-authored turns to judge", evidence: { modelTurns: 0, toolCalls: 0 }, policy: { toollessSessionTurns: 5 } });
});

test('blocks when five model turns have zero tool calls', () => {
  const turns = Array.from({ length: 5 }, () => ({ modelAuthored: true, toolCallCount: 0 }));
  const r = toollessSession(turns);
  assert.deepEqual(r, { rule: "toolless-session", verdict: "block", reason: "5 model turns and not one tool call", evidence: { modelTurns: 5, toolCalls: 0 }, policy: { toollessSessionTurns: 5 } });
});

test('passes when five model turns have at least one tool call', () => {
  const turns = Array.from({ length: 5 }, (_, i) => ({
    modelAuthored: true,
    toolCallCount: i === 0 ? 1 : 0,
  }));
  const r = toollessSession(turns);
  assert.deepEqual(r, { rule: "toolless-session", verdict: "pass", reason: "5 model turn(s), 1 tool call(s)", evidence: { modelTurns: 5, toolCalls: 1 }, policy: { toollessSessionTurns: 5 } });
});

test('passes when four model turns have zero tool calls', () => {
  const turns = Array.from({ length: 4 }, () => ({ modelAuthored: true, toolCallCount: 0 }));
  const r = toollessSession(turns);
  assert.deepEqual(r, { rule: "toolless-session", verdict: "pass", reason: "4 model turn(s), 0 tool call(s)", evidence: { modelTurns: 4, toolCalls: 0 }, policy: { toollessSessionTurns: 5 } });
});

test('blocks when six model turns have zero tool calls', () => {
  const turns = Array.from({ length: 6 }, () => ({ modelAuthored: true, toolCallCount: 0 }));
  const r = toollessSession(turns);
  assert.deepEqual(r, { rule: "toolless-session", verdict: "block", reason: "6 model turns and not one tool call", evidence: { modelTurns: 6, toolCalls: 0 }, policy: { toollessSessionTurns: 5 } });
});

test('passes when one model turn has zero tool calls', () => {
  const turns = [{ modelAuthored: true, toolCallCount: 0 }];
  const r = toollessSession(turns);
  assert.deepEqual(r, { rule: "toolless-session", verdict: "pass", reason: "1 model turn(s), 0 tool call(s)", evidence: { modelTurns: 1, toolCalls: 0 }, policy: { toollessSessionTurns: 5 } });
});

test('passes when one model turn has one tool call', () => {
  const turns = [{ modelAuthored: true, toolCallCount: 1 }];
  const r = toollessSession(turns);
  assert.deepEqual(r, { rule: "toolless-session", verdict: "pass", reason: "1 model turn(s), 1 tool call(s)", evidence: { modelTurns: 1, toolCalls: 1 }, policy: { toollessSessionTurns: 5 } });
});

test('blocks when five model turns have undefined toolCallCount', () => {
  const turns = Array.from({ length: 5 }, () => ({ modelAuthored: true }));
  const r = toollessSession(turns);
  assert.deepEqual(r, { rule: "toolless-session", verdict: "block", reason: "5 model turns and not one tool call", evidence: { modelTurns: 5, toolCalls: 0 }, policy: { toollessSessionTurns: 5 } });
});
