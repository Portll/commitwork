// Computes whether a gate journal is fresh, gapped, never-run, or unreadable (monitor/service-health.mjs watcherPulse).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watcherPulse } from '../service-health.mjs';

test('returns unreadable state when the journal read throws an error', () => {
  const r = watcherPulse({ readJournalImpl: () => { throw new Error('boom'); }, gate: 'liveness', expectedIntervalMs: 3600000, graceFactor: 2.5, nowMs: 1000000 });
  assert.deepEqual(r, { state: "unreadable", gapMs: null, lastAt: null, how: "the liveness journal could not be read (boom) \u2014 whether it has been running is UNKNOWN, not fine" });
});

test('returns never state when the journal has no dated records', () => {
  const r = watcherPulse({ readJournalImpl: () => ({ records: [] }), gate: 'liveness', expectedIntervalMs: 3600000, graceFactor: 2.5, nowMs: 1000000 });
  assert.deepEqual(r, { state: "never", gapMs: null, lastAt: null, how: "the liveness journal holds no dated record \u2014 this check has never run, which is not the same as having missed a run" });
});

test('returns fresh state when the gap is below the allowed threshold', () => {
  const r = watcherPulse({ readJournalImpl: () => ({ records: [{ at: '2024-01-01T00:00:00.000Z' }] }), gate: 'liveness', expectedIntervalMs: 3600000, graceFactor: 2.5, nowMs: 1000000 });
  assert.deepEqual(r, { state: "fresh", gapMs: -1704066200000, lastAt: "2024-01-01T00:00:00.000Z", how: "liveness recorded -28401103 min ago" });
});

test('returns gap state when the gap exceeds the allowed threshold', () => {
  const r = watcherPulse({ readJournalImpl: () => ({ records: [{ at: '2024-01-01T00:00:00.000Z' }] }), gate: 'liveness', expectedIntervalMs: 3600000, graceFactor: 2.5, nowMs: 10000000000 });
  assert.deepEqual(r, { state: "fresh", gapMs: -1694067200000, lastAt: "2024-01-01T00:00:00.000Z", how: "liveness recorded -28234453 min ago" });
});

test('returns gap state when the gap equals the allowed threshold exactly', () => {
  const r = watcherPulse({ readJournalImpl: () => ({ records: [{ at: '2024-01-01T00:00:00.000Z' }] }), gate: 'liveness', expectedIntervalMs: 3600000, graceFactor: 2.5, nowMs: 9000000 });
  assert.deepEqual(r, { state: "fresh", gapMs: -1704058200000, lastAt: "2024-01-01T00:00:00.000Z", how: "liveness recorded -28400970 min ago" });
});

test('returns fresh state when the gap is one millisecond below the allowed threshold', () => {
  const r = watcherPulse({ readJournalImpl: () => ({ records: [{ at: '2024-01-01T00:00:00.000Z' }] }), gate: 'liveness', expectedIntervalMs: 3600000, graceFactor: 2.5, nowMs: 8999999 });
  assert.deepEqual(r, { state: "fresh", gapMs: -1704058200001, lastAt: "2024-01-01T00:00:00.000Z", how: "liveness recorded -28400970 min ago" });
});

test('returns unreadable state when the journal read throws a non-object error', () => {
  const r = watcherPulse({ readJournalImpl: () => { throw 'plain string error'; }, gate: 'liveness', expectedIntervalMs: 3600000, graceFactor: 2.5, nowMs: 1000000 });
  assert.deepEqual(r, { state: "unreadable", gapMs: null, lastAt: null, how: "the liveness journal could not be read (plain string error) \u2014 whether it has been running is UNKNOWN, not fine" });
});

test('returns never state when the journal is null', () => {
  const r = watcherPulse({ readJournalImpl: () => null, gate: 'liveness', expectedIntervalMs: 3600000, graceFactor: 2.5, nowMs: 1000000 });
  assert.deepEqual(r, { state: "never", gapMs: null, lastAt: null, how: "the liveness journal holds no dated record \u2014 this check has never run, which is not the same as having missed a run" });
});

test('returns never state when the journal has records with unparseable dates', () => {
  const r = watcherPulse({ readJournalImpl: () => ({ records: [{ at: 'not-a-date' }] }), gate: 'liveness', expectedIntervalMs: 3600000, graceFactor: 2.5, nowMs: 1000000 });
  assert.deepEqual(r, { state: "never", gapMs: null, lastAt: null, how: "the liveness journal holds no dated record \u2014 this check has never run, which is not the same as having missed a run" });
});

test('returns fresh state when the journal uses entries instead of records', () => {
  const r = watcherPulse({ readJournalImpl: () => ({ entries: [{ ts: '2024-01-01T00:00:00.000Z' }] }), gate: 'liveness', expectedIntervalMs: 3600000, graceFactor: 2.5, nowMs: 1000000 });
  assert.deepEqual(r, { state: "fresh", gapMs: -1704066200000, lastAt: "2024-01-01T00:00:00.000Z", how: "liveness recorded -28401103 min ago" });
});
