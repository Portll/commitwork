// transportAbortUnread computes whether a turn ended on a transport abort with no state read (bin/lib/turn-gate-core.mjs transportAbortUnread).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transportAbortUnread } from '../lib/turn-gate-core.mjs';

test('returns pass with count 0 when no turn has transport aborts', () => {
  const turns = [
    { modelAuthored: true, transportAborts: 0, callsAfterAbort: 0, toolCallCount: 5, openedByUuid: 'a' },
    { modelAuthored: true, transportAborts: 0, callsAfterAbort: 0, toolCallCount: 3, openedByUuid: 'b' },
  ];
  assert.deepEqual(transportAbortUnread(turns), { rule: "transport-abort", verdict: "pass", reason: "no transport abort in any turn", evidence: { count: 0, turns: [] }, policy: {} });
});

test('returns pass with count 0 when turns is not an array', () => {
  assert.deepEqual(transportAbortUnread(null), { rule: "transport-abort", verdict: "pass", reason: "no transport abort in any turn", evidence: { count: 0, turns: [] }, policy: {} });
});

test('returns pass when a turn with aborts is followed by a state read', () => {
  const turns = [
    { modelAuthored: true, transportAborts: 2, callsAfterAbort: 0, toolCallCount: 0, openedByUuid: 'x' },
    { modelAuthored: true, transportAborts: 0, callsAfterAbort: 0, toolCallCount: 4, openedByUuid: 'y' },
  ];
  assert.deepEqual(transportAbortUnread(turns), { rule: "transport-abort", verdict: "pass", reason: "1 transport abort(s), every one followed by a state read", evidence: { count: 0, turns: [], seen: 1 }, policy: {} });
});

test('returns block when a turn with aborts has no next turn', () => {
  const turns = [
    { modelAuthored: true, transportAborts: 1, callsAfterAbort: 0, toolCallCount: 0, openedByUuid: 'z' },
  ];
  assert.deepEqual(transportAbortUnread(turns), { rule: "transport-abort", verdict: "block", reason: "1 of 1 turn(s) ended on a transport abort with no state read \u2014 a closed stream is not a decision", evidence: { count: 1, turns: [{ openedByUuid: "z" }], seen: 1 }, policy: {} });
});

test('returns block when a turn with aborts is followed by a turn with zero tool calls', () => {
  const turns = [
    { modelAuthored: true, transportAborts: 3, callsAfterAbort: 0, toolCallCount: 0, openedByUuid: 'p' },
    { modelAuthored: true, transportAborts: 0, callsAfterAbort: 0, toolCallCount: 0, openedByUuid: 'q' },
  ];
  assert.deepEqual(transportAbortUnread(turns), { rule: "transport-abort", verdict: "block", reason: "1 of 1 turn(s) ended on a transport abort with no state read \u2014 a closed stream is not a decision", evidence: { count: 1, turns: [{ openedByUuid: "p" }], seen: 1 }, policy: {} });
});

test('returns pass when a turn with aborts has callsAfterAbort greater than zero', () => {
  const turns = [
    { modelAuthored: true, transportAborts: 1, callsAfterAbort: 2, toolCallCount: 0, openedByUuid: 'm' },
    { modelAuthored: true, transportAborts: 0, callsAfterAbort: 0, toolCallCount: 0, openedByUuid: 'n' },
  ];
  assert.deepEqual(transportAbortUnread(turns), { rule: "transport-abort", verdict: "pass", reason: "1 transport abort(s), every one followed by a state read", evidence: { count: 0, turns: [], seen: 1 }, policy: {} });
});

test('excludes turns with modelAuthored false from the list', () => {
  const turns = [
    { modelAuthored: false, transportAborts: 5, callsAfterAbort: 0, toolCallCount: 0, openedByUuid: 'f' },
    { modelAuthored: true, transportAborts: 0, callsAfterAbort: 0, toolCallCount: 2, openedByUuid: 'g' },
  ];
  assert.deepEqual(transportAbortUnread(turns), { rule: "transport-abort", verdict: "pass", reason: "no transport abort in any turn", evidence: { count: 0, turns: [] }, policy: {} });
});

test('returns block when multiple turns with aborts are unread', () => {
  const turns = [
    { modelAuthored: true, transportAborts: 1, callsAfterAbort: 0, toolCallCount: 0, openedByUuid: 'u1' },
    { modelAuthored: true, transportAborts: 0, callsAfterAbort: 0, toolCallCount: 0, openedByUuid: 'u2' },
    { modelAuthored: true, transportAborts: 2, callsAfterAbort: 0, toolCallCount: 0, openedByUuid: 'u3' },
  ];
  assert.deepEqual(transportAbortUnread(turns), { rule: "transport-abort", verdict: "block", reason: "2 of 2 turn(s) ended on a transport abort with no state read \u2014 a closed stream is not a decision", evidence: { count: 2, turns: [{ openedByUuid: "u1" }, { openedByUuid: "u3" }], seen: 2 }, policy: {} });
});
