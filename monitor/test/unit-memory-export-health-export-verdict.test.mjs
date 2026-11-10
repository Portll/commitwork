// Maps a health record to a verdict object with state, rank, kind, reason, counts, tallyDivergence, receiptsAt, undated, failedReasons (monitor/memory-export-health.mjs exportVerdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportVerdict } from '../memory-export-health.mjs';

test('returns null reason when h.reason is falsy', () => {
  const h = { state: 'verified', rank: 0, kind: 'ok', reason: '', counts: { a: 1 }, tallyDivergence: null, generated: '2024-01-01', undated: false, failedReasons: [] };
  const r = exportVerdict(h);
  assert.equal(r.reason, null);
});

test('returns null reason when h.reason is undefined', () => {
  const h = { state: 'verified', rank: 0, kind: 'ok', counts: { a: 1 }, tallyDivergence: null, generated: '2024-01-01', undated: false, failedReasons: [] };
  const r = exportVerdict(h);
  assert.equal(r.reason, null);
});

test('returns the reason string when h.reason is truthy', () => {
  const h = { state: 'failed', rank: 5, kind: 'bad', reason: 'hash mismatch', counts: { a: 2 }, tallyDivergence: { state: 'diverged' }, generated: '2024-01-02', undated: true, failedReasons: ['x'] };
  const r = exportVerdict(h);
  assert.equal(r.reason, "hash mismatch");
});

test('returns null tallyDivergence when h.tallyDivergence is null', () => {
  const h = { state: 'verified', rank: 0, kind: 'ok', reason: null, counts: null, tallyDivergence: null, generated: '2024-01-01', undated: false, failedReasons: [] };
  const r = exportVerdict(h);
  assert.equal(r.tallyDivergence, null);
});

test('returns tallyDivergence state when h.tallyDivergence is an object', () => {
  const h = { state: 'degraded', rank: 2, kind: 'warn', reason: null, counts: { b: 3 }, tallyDivergence: { state: 'agrees' }, generated: '2024-01-03', undated: false, failedReasons: [] };
  const r = exportVerdict(h);
  assert.equal(r.tallyDivergence, "agrees");
});

test('coerces undated to boolean true', () => {
  const h = { state: 'stale', rank: 3, kind: 'warn', reason: null, counts: null, tallyDivergence: null, generated: null, undated: 1, failedReasons: [] };
  const r = exportVerdict(h);
  assert.equal(r.undated, true);
});

test('coerces undated to boolean false', () => {
  const h = { state: 'verified', rank: 0, kind: 'ok', reason: null, counts: null, tallyDivergence: null, generated: '2024-01-01', undated: 0, failedReasons: [] };
  const r = exportVerdict(h);
  assert.equal(r.undated, false);
});

test('passes through failedReasons array', () => {
  const h = { state: 'failed', rank: 5, kind: 'bad', reason: 'r', counts: { c: 4 }, tallyDivergence: { state: 'diverged' }, generated: '2024-01-04', undated: true, failedReasons: ['a', 'b'] };
  const r = exportVerdict(h);
  assert.deepEqual(r.failedReasons, ["a", "b"]);
});
