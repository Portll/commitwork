// Detects assigned items that are neither advanced nor covered by a blocker (bin/lib/turn-gate-core.mjs strandedAssignment).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strandedAssignment } from '../lib/turn-gate-core.mjs';

test('returns unknown verdict when ledger is falsy', () => {
  assert.deepEqual(strandedAssignment(null), { rule: "stranded-assignment", verdict: "unknown", reason: "no task ledger supplied \u2014 nothing to compare", evidence: { count: 0, turns: [] }, policy: {} });
});

test('returns unknown verdict when assigned or touched is undefined', () => {
  assert.deepEqual(strandedAssignment({ assigned: undefined, touched: [] }), { rule: "stranded-assignment", verdict: "unknown", reason: "assigned or touched set unreadable", evidence: { count: 0, turns: [] }, policy: {} });
});

test('returns pass with settled reason when assigned is empty and planId exists', () => {
  assert.deepEqual(strandedAssignment({ assigned: [], touched: [], planId: 'plan-1' }), { rule: "stranded-assignment", verdict: "pass", reason: "every assigned item on plan-1 is settled", evidence: { count: 0, turns: [], assigned: 0 }, policy: {} });
});

test('returns pass with no-plan reason when assigned is empty and no planId', () => {
  assert.deepEqual(strandedAssignment({ assigned: [], touched: [] }), { rule: "stranded-assignment", verdict: "pass", reason: "no plan bound to this session \u2014 nothing assigned to compare", evidence: { count: 0, turns: [], assigned: 0 }, policy: {} });
});

test('returns block when assigned item is neither touched nor covered', () => {
  assert.deepEqual(strandedAssignment({ assigned: [{ id: 'a1' }], touched: [] }), { rule: "stranded-assignment", verdict: "block", reason: "1 of 1 assigned item(s) neither advanced nor covered by a named blocker", evidence: { count: 1, turns: [], stranded: ["a1"], assigned: 1 }, policy: {} });
});

test('returns pass when all assigned items are touched', () => {
  assert.deepEqual(strandedAssignment({ assigned: [{ id: 'a1' }, { id: 'a2' }], touched: ['a1', 'a2'] }), { rule: "stranded-assignment", verdict: "pass", reason: "2 assigned, all advanced or covered", evidence: { count: 0, turns: [], stranded: [], assigned: 2 }, policy: {} });
});

test('returns pass when stranded item is covered by a blocker', () => {
  assert.deepEqual(strandedAssignment({ assigned: [{ id: 'a1' }], touched: [], blockers: [{ covers: ['a1'] }] }), { rule: "stranded-assignment", verdict: "pass", reason: "1 assigned, all advanced or covered", evidence: { count: 0, turns: [], stranded: [], assigned: 1 }, policy: {} });
});

test('returns block when only some assigned items are stranded', () => {
  assert.deepEqual(strandedAssignment({ assigned: [{ id: 'a1' }, { id: 'a2' }], touched: ['a1'] }), { rule: "stranded-assignment", verdict: "block", reason: "1 of 2 assigned item(s) neither advanced nor covered by a named blocker", evidence: { count: 1, turns: [], stranded: ["a2"], assigned: 2 }, policy: {} });
});
