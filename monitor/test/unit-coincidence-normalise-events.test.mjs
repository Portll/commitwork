// Sorts and filters events by parsed timestamp, counting undated ones (monitor/coincidence.mjs normaliseEvents).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseEvents } from '../coincidence.mjs';

test('returns empty events and zero undated for empty input', () => {
  assert.deepEqual(normaliseEvents([]), { events: [], undated: 0 });
});

test('counts undated events with invalid timestamps', () => {
  const events = [
    { kind: 'a', at: 'not-a-date', label: null, ref: null },
    { kind: 'b', at: '2024-01-01T00:00:00Z', label: null, ref: null }
  ];
  assert.deepEqual(normaliseEvents(events), { events: [{ kind: "b", at: "2024-01-01T00:00:00Z", t: 1704067200000, label: null, ref: null }], undated: 1 });
});

test('keeps valid events with parsed timestamps', () => {
  const events = [
    { kind: 'push', at: '2024-01-01T00:00:00Z', label: 'main', ref: 'refs/heads/main' }
  ];
  assert.deepEqual(normaliseEvents(events), { events: [{ kind: "push", at: "2024-01-01T00:00:00Z", t: 1704067200000, label: "main", ref: "refs/heads/main" }], undated: 0 });
});

test('sorts events by timestamp then kind then label', () => {
  const events = [
    { kind: 'z', at: '2024-01-01T00:00:00Z', label: 'b', ref: null },
    { kind: 'a', at: '2024-01-01T00:00:00Z', label: 'a', ref: null },
    { kind: 'a', at: '2024-01-01T00:00:00Z', label: 'b', ref: null }
  ];
  assert.deepEqual(normaliseEvents(events), { events: [{ kind: "a", at: "2024-01-01T00:00:00Z", t: 1704067200000, label: "a", ref: null }, { kind: "a", at: "2024-01-01T00:00:00Z", t: 1704067200000, label: "b", ref: null }, { kind: "z", at: "2024-01-01T00:00:00Z", t: 1704067200000, label: "b", ref: null }], undated: 0 });
});

test('handles null label and ref with default null', () => {
  const events = [
    { kind: 'commit', at: '2024-01-01T00:00:00Z' }
  ];
  assert.deepEqual(normaliseEvents(events), { events: [{ kind: "commit", at: "2024-01-01T00:00:00Z", t: 1704067200000, label: null, ref: null }], undated: 0 });
});

test('sorts events with different timestamps in ascending order', () => {
  const events = [
    { kind: 'x', at: '2024-01-02T00:00:00Z', label: null, ref: null },
    { kind: 'y', at: '2024-01-01T00:00:00Z', label: null, ref: null }
  ];
  assert.deepEqual(normaliseEvents(events), { events: [{ kind: "y", at: "2024-01-01T00:00:00Z", t: 1704067200000, label: null, ref: null }, { kind: "x", at: "2024-01-02T00:00:00Z", t: 1704153600000, label: null, ref: null }], undated: 0 });
});

test('handles events with same timestamp but different kinds', () => {
  const events = [
    { kind: 'beta', at: '2024-01-01T00:00:00Z', label: null, ref: null },
    { kind: 'alpha', at: '2024-01-01T00:00:00Z', label: null, ref: null }
  ];
  assert.deepEqual(normaliseEvents(events), { events: [{ kind: "alpha", at: "2024-01-01T00:00:00Z", t: 1704067200000, label: null, ref: null }, { kind: "beta", at: "2024-01-01T00:00:00Z", t: 1704067200000, label: null, ref: null }], undated: 0 });
});

test('handles events with same timestamp and kind but different labels', () => {
  const events = [
    { kind: 'same', at: '2024-01-01T00:00:00Z', label: 'zeta', ref: null },
    { kind: 'same', at: '2024-01-01T00:00:00Z', label: 'alpha', ref: null }
  ];
  assert.deepEqual(normaliseEvents(events), { events: [{ kind: "same", at: "2024-01-01T00:00:00Z", t: 1704067200000, label: "alpha", ref: null }, { kind: "same", at: "2024-01-01T00:00:00Z", t: 1704067200000, label: "zeta", ref: null }], undated: 0 });
});

test('handles events with same timestamp, kind, and label', () => {
  const events = [
    { kind: 'dup', at: '2024-01-01T00:00:00Z', label: 'same', ref: 'r1' },
    { kind: 'dup', at: '2024-01-01T00:00:00Z', label: 'same', ref: 'r2' }
  ];
  assert.deepEqual(normaliseEvents(events), { events: [{ kind: "dup", at: "2024-01-01T00:00:00Z", t: 1704067200000, label: "same", ref: "r1" }, { kind: "dup", at: "2024-01-01T00:00:00Z", t: 1704067200000, label: "same", ref: "r2" }], undated: 0 });
});

test('handles mixed valid and undated events', () => {
  const events = [
    { kind: 'valid', at: '2024-01-01T00:00:00Z', label: 'l1', ref: 'r1' },
    { kind: 'bad', at: 'garbage', label: 'l2', ref: 'r2' },
    { kind: 'valid2', at: '2024-01-02T00:00:00Z', label: 'l3', ref: 'r3' }
  ];
  assert.deepEqual(normaliseEvents(events), { events: [{ kind: "valid", at: "2024-01-01T00:00:00Z", t: 1704067200000, label: "l1", ref: "r1" }, { kind: "valid2", at: "2024-01-02T00:00:00Z", t: 1704153600000, label: "l3", ref: "r3" }], undated: 1 });
});
