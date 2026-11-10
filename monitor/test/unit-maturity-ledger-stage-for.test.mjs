// Computes the maturity stage for a check based on its declaration, lane, rows, and identity (monitor/maturity-ledger.mjs stageFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageFor } from '../maturity-ledger.mjs';

test('returns null stage when not declared', () => {
  const r = stageFor({ declared: false, lane: 'x', nonPublishing: null, producedRows: true, hasDetectorIdentity: true });
  assert.deepEqual(r, { stage: null, why: "not declared in any manifest \u2014 this check does not exist" });
});

test('returns wired stage when declared non-publishing', () => {
  const r = stageFor({ declared: true, lane: 'x', nonPublishing: 'reason', producedRows: true, hasDetectorIdentity: true });
  assert.deepEqual(r, { stage: "wired", why: "declared non-publishing: reason", terminal: true });
});

test('returns declared stage when no lane', () => {
  const r = stageFor({ declared: true, lane: null, nonPublishing: null, producedRows: true, hasDetectorIdentity: true });
  assert.deepEqual(r, { stage: "declared", why: "declared but reaches no lane, so it cannot carry a finding anywhere" });
});

test('returns wired stage when lane exists but no rows', () => {
  const r = stageFor({ declared: true, lane: 'x', nonPublishing: null, producedRows: false, hasDetectorIdentity: true });
  assert.deepEqual(r, { stage: "wired", why: "has a lane but emitted no rows in the latest rollup" });
});

test('returns producing stage when rows exist but no detector identity', () => {
  const r = stageFor({ declared: true, lane: 'x', nonPublishing: null, producedRows: true, hasDetectorIdentity: false });
  assert.deepEqual(r, { stage: "producing", why: "emits rows, but they carry no detector identity \u2014 a finding here cannot be attributed to anything fixable" });
});

test('returns gradeable stage when all conditions met', () => {
  const r = stageFor({ declared: true, lane: 'x', nonPublishing: null, producedRows: true, hasDetectorIdentity: true });
  assert.deepEqual(r, { stage: "gradeable", why: "emits rows carrying a detector identity" });
});
