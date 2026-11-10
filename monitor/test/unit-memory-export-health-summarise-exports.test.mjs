// Aggregates per-area export states into counts, groups, receipts, and an alarming list (monitor/memory-export-health.mjs summariseExports).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseExports } from '../memory-export-health.mjs';

test('empty input returns zeroed summary with no alarming rows', () => {
  const r = summariseExports([]);
  assert.deepEqual(r, { areasCounted: 0, byState: { verified: 0, "not-attempted": 0, skipped: 0, degraded: 0, stale: 0, absent: 0, failed: 0, unreadable: 0 }, groups: { ok: [], behind: [], broken: [] }, counts: { ok: 0, behind: 0, broken: 0 }, receipts: 0, failedReceipts: 0, unverifiedReceipts: 0, worstRank: 0, needsAttention: 0, alarming: [] });
});

test('single verified area with counts tallies receipts and failed receipts', () => {
  const r = summariseExports([{ state: 'verified', area: 'a', counts: { total: 10, failed: 2, acceptedUnverified: 1 } }]);
  assert.deepEqual(r, { areasCounted: 1, byState: { verified: 1, "not-attempted": 0, skipped: 0, degraded: 0, stale: 0, absent: 0, failed: 0, unreadable: 0 }, groups: { ok: ["a"], behind: [], broken: [] }, counts: { ok: 1, behind: 0, broken: 0 }, receipts: 10, failedReceipts: 2, unverifiedReceipts: 1, worstRank: 0, needsAttention: 0, alarming: [] });
});

test('degraded area appears in behind group and alarming list with rank 1', () => {
  const r = summariseExports([{ state: 'degraded', area: 'a', reason: 'partial' }]);
  assert.deepEqual(r, { areasCounted: 1, byState: { verified: 0, "not-attempted": 0, skipped: 0, degraded: 1, stale: 0, absent: 0, failed: 0, unreadable: 0 }, groups: { ok: [], behind: ["a"], broken: [] }, counts: { ok: 0, behind: 1, broken: 0 }, receipts: 0, failedReceipts: 0, unverifiedReceipts: 0, worstRank: 1, needsAttention: 1, alarming: [{ area: "a", state: "degraded", rank: 1, kind: "behind", reason: "partial" }] });
});

test('failed area appears in broken group with rank 3 and reason', () => {
  const r = summariseExports([{ state: 'failed', area: 'a', reason: 'write error' }]);
  assert.deepEqual(r, { areasCounted: 1, byState: { verified: 0, "not-attempted": 0, skipped: 0, degraded: 0, stale: 0, absent: 0, failed: 1, unreadable: 0 }, groups: { ok: [], behind: [], broken: ["a"] }, counts: { ok: 0, behind: 0, broken: 1 }, receipts: 0, failedReceipts: 0, unverifiedReceipts: 0, worstRank: 3, needsAttention: 1, alarming: [{ area: "a", state: "failed", rank: 3, kind: "broken", reason: "write error" }] });
});

test('unreadable area with out field uses out for area in groups and alarming', () => {
  const r = summariseExports([{ state: 'unreadable', out: 'o', reason: 'io' }]);
  assert.deepEqual(r, { areasCounted: 1, byState: { verified: 0, "not-attempted": 0, skipped: 0, degraded: 0, stale: 0, absent: 0, failed: 0, unreadable: 1 }, groups: { ok: [], behind: [], broken: ["o"] }, counts: { ok: 0, behind: 0, broken: 1 }, receipts: 0, failedReceipts: 0, unverifiedReceipts: 0, worstRank: 3, needsAttention: 1, alarming: [{ area: "o", state: "unreadable", rank: 3, kind: "broken", reason: "io" }] });
});

test('alarming sorts by rank descending then area ascending', () => {
  const r = summariseExports([
    { state: 'stale', area: 'b' },
    { state: 'failed', area: 'a' },
    { state: 'degraded', area: 'c' },
    { state: 'stale', area: 'a' },
  ]);
  assert.deepEqual(r, { areasCounted: 4, byState: { verified: 0, "not-attempted": 0, skipped: 0, degraded: 1, stale: 2, absent: 0, failed: 1, unreadable: 0 }, groups: { ok: [], behind: ["b", "c", "a"], broken: ["a"] }, counts: { ok: 0, behind: 3, broken: 1 }, receipts: 0, failedReceipts: 0, unverifiedReceipts: 0, worstRank: 3, needsAttention: 4, alarming: [{ area: "a", state: "failed", rank: 3, kind: "broken", reason: null }, { area: "a", state: "stale", rank: 2, kind: "behind", reason: null }, { area: "b", state: "stale", rank: 2, kind: "behind", reason: null }, { area: "c", state: "degraded", rank: 1, kind: "behind", reason: null }] });
});

test('needsAttention counts behind and broken but not ok states', () => {
  const r = summariseExports([
    { state: 'verified', area: 'a' },
    { state: 'skipped', area: 'b' },
    { state: 'degraded', area: 'c' },
    { state: 'failed', area: 'd' },
  ]);
  assert.deepEqual(r, { areasCounted: 4, byState: { verified: 1, "not-attempted": 0, skipped: 1, degraded: 1, stale: 0, absent: 0, failed: 1, unreadable: 0 }, groups: { ok: ["a", "b"], behind: ["c"], broken: ["d"] }, counts: { ok: 2, behind: 1, broken: 1 }, receipts: 0, failedReceipts: 0, unverifiedReceipts: 0, worstRank: 3, needsAttention: 2, alarming: [{ area: "d", state: "failed", rank: 3, kind: "broken", reason: null }, { area: "c", state: "degraded", rank: 1, kind: "behind", reason: null }] });
});

test('worstRank is 0 when all areas are verified or not-attempted', () => {
  const r = summariseExports([
    { state: 'verified', area: 'a' },
    { state: 'not-attempted', area: 'b' },
  ]);
  assert.deepEqual(r, { areasCounted: 2, byState: { verified: 1, "not-attempted": 1, skipped: 0, degraded: 0, stale: 0, absent: 0, failed: 0, unreadable: 0 }, groups: { ok: ["a", "b"], behind: [], broken: [] }, counts: { ok: 2, behind: 0, broken: 0 }, receipts: 0, failedReceipts: 0, unverifiedReceipts: 0, worstRank: 0, needsAttention: 0, alarming: [] });
});

test('area without area or out field maps to null in groups and alarming', () => {
  const r = summariseExports([{ state: 'stale', reason: 'old' }]);
  assert.deepEqual(r, { areasCounted: 1, byState: { verified: 0, "not-attempted": 0, skipped: 0, degraded: 0, stale: 1, absent: 0, failed: 0, unreadable: 0 }, groups: { ok: [], behind: [null], broken: [] }, counts: { ok: 0, behind: 1, broken: 0 }, receipts: 0, failedReceipts: 0, unverifiedReceipts: 0, worstRank: 2, needsAttention: 1, alarming: [{ area: null, state: "stale", rank: 2, kind: "behind", reason: "old" }] });
});

test('non-array input is treated as empty rows', () => {
  const r = summariseExports(null);
  assert.deepEqual(r, { areasCounted: 0, byState: { verified: 0, "not-attempted": 0, skipped: 0, degraded: 0, stale: 0, absent: 0, failed: 0, unreadable: 0 }, groups: { ok: [], behind: [], broken: [] }, counts: { ok: 0, behind: 0, broken: 0 }, receipts: 0, failedReceipts: 0, unverifiedReceipts: 0, worstRank: 0, needsAttention: 0, alarming: [] });
});
