// Reconstructs a placeholder goal string for a skeleton task whose original goal text is unrecoverable (bin/spine-replay-core.mjs reconstructedGoal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconstructedGoal } from '../spine-replay-core.mjs';

test('uses at when first equals last and no set_status', () => {
  const ev = { rows: 1, kinds: {}, first: 't1', last: 't1', sessions: ['s1'], viaRows: 0 };
  const r = reconstructedGoal(ev, { plan: 'p', task: 't' });
  assert.equal(r, "[RECONSTRUCTED SKELETON \u2014 ORIGINAL GOAL UNRECOVERABLE] No goal text for p/t survives anywhere on this box. The attribution ledger (.claude/store/spine-touches.jsonl) records ids only, by design \u2014 it never held a goal, result or note to lose. Ledger evidence: 1 row(s) [] at t1; session(s) s1. STATUS IS UNKNOWN: no set_status row names this task, so whether its status ever changed was never recorded; this task is filed at the schema default 'pending', which is a placeholder and not a claim that the work is outstanding.");
});

test('uses from-to when first differs from last and no set_status', () => {
  const ev = { rows: 2, kinds: {}, first: 't1', last: 't2', sessions: ['s1'], viaRows: 0 };
  const r = reconstructedGoal(ev, { plan: 'p', task: 't' });
  assert.equal(r, "[RECONSTRUCTED SKELETON \u2014 ORIGINAL GOAL UNRECOVERABLE] No goal text for p/t survives anywhere on this box. The attribution ledger (.claude/store/spine-touches.jsonl) records ids only, by design \u2014 it never held a goal, result or note to lose. Ledger evidence: 2 row(s) [] from t1 to t2; session(s) s1. STATUS IS UNKNOWN: no set_status row names this task, so whether its status ever changed was never recorded; this task is filed at the schema default 'pending', which is a placeholder and not a claim that the work is outstanding.");
});

test('reports set_status count when present', () => {
  const ev = { rows: 3, kinds: { set_status: 2 }, first: 't1', last: 't1', sessions: ['s1'], viaRows: 0 };
  const r = reconstructedGoal(ev, { plan: 'p', task: 't' });
  assert.equal(r, "[RECONSTRUCTED SKELETON \u2014 ORIGINAL GOAL UNRECOVERABLE] No goal text for p/t survives anywhere on this box. The attribution ledger (.claude/store/spine-touches.jsonl) records ids only, by design \u2014 it never held a goal, result or note to lose. Ledger evidence: 3 row(s) [set_status\u00d72] at t1; session(s) s1. STATUS WAS NOT RECOVERED: the ledger records that a status was set 2 time(s), never to what; this task is filed at the schema default 'pending', which is a placeholder and not a claim that the work is outstanding.");
});

test('reports none recorded when sessions is empty', () => {
  const ev = { rows: 1, kinds: {}, first: 't1', last: 't1', sessions: [], viaRows: 0 };
  const r = reconstructedGoal(ev, { plan: 'p', task: 't' });
  assert.equal(r, "[RECONSTRUCTED SKELETON \u2014 ORIGINAL GOAL UNRECOVERABLE] No goal text for p/t survives anywhere on this box. The attribution ledger (.claude/store/spine-touches.jsonl) records ids only, by design \u2014 it never held a goal, result or note to lose. Ledger evidence: 1 row(s) [] at t1; session(s) none recorded. STATUS IS UNKNOWN: no set_status row names this task, so whether its status ever changed was never recorded; this task is filed at the schema default 'pending', which is a placeholder and not a claim that the work is outstanding.");
});

test('lists sessions up to cap with more indicator', () => {
  const sessions = Array.from({ length: 5 }, (_, i) => `s${i}`);
  const ev = { rows: 5, kinds: {}, first: 't1', last: 't2', sessions, viaRows: 0 };
  const r = reconstructedGoal(ev, { plan: 'p', task: 't' });
  assert.equal(r, "[RECONSTRUCTED SKELETON \u2014 ORIGINAL GOAL UNRECOVERABLE] No goal text for p/t survives anywhere on this box. The attribution ledger (.claude/store/spine-touches.jsonl) records ids only, by design \u2014 it never held a goal, result or note to lose. Ledger evidence: 5 row(s) [] from t1 to t2; session(s) s0, s1, s2 +2 more. STATUS IS UNKNOWN: no set_status row names this task, so whether its status ever changed was never recorded; this task is filed at the schema default 'pending', which is a placeholder and not a claim that the work is outstanding.");
});

test('appends bypass note when viaRows is nonzero', () => {
  const ev = { rows: 4, kinds: { set_status: 1 }, first: 't1', last: 't2', sessions: ['s1', 's2'], viaRows: 2 };
  const r = reconstructedGoal(ev, { plan: 'p', task: 't' });
  assert.equal(r, "[RECONSTRUCTED SKELETON \u2014 ORIGINAL GOAL UNRECOVERABLE] No goal text for p/t survives anywhere on this box. The attribution ledger (.claude/store/spine-touches.jsonl) records ids only, by design \u2014 it never held a goal, result or note to lose. Ledger evidence: 4 row(s) [set_status\u00d71] from t1 to t2; session(s) s1, s2. STATUS WAS NOT RECOVERED: the ledger records that a status was set 1 time(s), never to what; this task is filed at the schema default 'pending', which is a placeholder and not a claim that the work is outstanding. 2 of these row(s) were filed by a bypass path (`via`: direct spine/db.mjs, not the MCP tool) and are not equivalent evidence.");
});

test('omits bypass note when viaRows is zero', () => {
  const ev = { rows: 2, kinds: { set_status: 1 }, first: 't1', last: 't2', sessions: ['s1', 's2'], viaRows: 0 };
  const r = reconstructedGoal(ev, { plan: 'p', task: 't' });
  assert.equal(r, "[RECONSTRUCTED SKELETON \u2014 ORIGINAL GOAL UNRECOVERABLE] No goal text for p/t survives anywhere on this box. The attribution ledger (.claude/store/spine-touches.jsonl) records ids only, by design \u2014 it never held a goal, result or note to lose. Ledger evidence: 2 row(s) [set_status\u00d71] from t1 to t2; session(s) s1, s2. STATUS WAS NOT RECOVERED: the ledger records that a status was set 1 time(s), never to what; this task is filed at the schema default 'pending', which is a placeholder and not a claim that the work is outstanding.");
});

test('summarizes multiple kinds in ledger evidence', () => {
  const ev = { rows: 6, kinds: { create: 2, set_status: 3, delete: 1 }, first: 't1', last: 't2', sessions: ['s1'], viaRows: 0 };
  const r = reconstructedGoal(ev, { plan: 'p', task: 't' });
  assert.equal(r, "[RECONSTRUCTED SKELETON \u2014 ORIGINAL GOAL UNRECOVERABLE] No goal text for p/t survives anywhere on this box. The attribution ledger (.claude/store/spine-touches.jsonl) records ids only, by design \u2014 it never held a goal, result or note to lose. Ledger evidence: 6 row(s) [create\u00d72 set_status\u00d73 delete\u00d71] from t1 to t2; session(s) s1. STATUS WAS NOT RECOVERED: the ledger records that a status was set 3 time(s), never to what; this task is filed at the schema default 'pending', which is a placeholder and not a claim that the work is outstanding.");
});
