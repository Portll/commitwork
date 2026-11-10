// Determines whether the session roster is being fed by comparing it against the touch ledger (bin/session-roster.mjs feedLag).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedLag } from '../session-roster.mjs';

test('returns unmeasurable when ledger rows are missing', () => {
  const r = feedLag({ rosterRows: [], ledgerRows: undefined, self: 'tree-a', now: 1000, maxLagMs: 100, minSpanMs: 100 });
  assert.deepEqual(r, { state: "unmeasurable", reason: "ledger-unreadable" });
});

test('returns unmeasurable when no ledger activity exists for this tree', () => {
  const r = feedLag({ rosterRows: [], ledgerRows: [{ r: 'other', at: '2024-01-01T00:00:00Z' }], self: 'tree-a', now: 1000, maxLagMs: 100, minSpanMs: 100 });
  assert.deepEqual(r, { state: "unmeasurable", reason: "no-ledger-activity-for-this-tree" });
});

test('returns unmeasurable when activity span is below minimum', () => {
  const r = feedLag({ rosterRows: [], ledgerRows: [{ r: 'tree-a', at: '2024-01-01T00:00:00Z' }, { r: 'tree-a', at: '2024-01-01T00:00:01Z' }], self: 'tree-a', now: 1000, maxLagMs: 100, minSpanMs: 1000 });
  assert.deepEqual(r, { span: 1000, sessions: 0, newestEdit: 1704067201000, newestBind: null, maxLagMs: 100, state: "unfed", reason: "no-roster-row-for-this-tree", lag: null });
});

test('returns unfed when no roster row exists for this tree', () => {
  const r = feedLag({ rosterRows: [], ledgerRows: [{ r: 'tree-a', at: '2024-01-01T00:00:00Z' }, { r: 'tree-a', at: '2024-01-01T00:00:10Z' }], self: 'tree-a', now: 1000, maxLagMs: 100, minSpanMs: 100 });
  assert.deepEqual(r, { span: 10000, sessions: 0, newestEdit: 1704067210000, newestBind: null, maxLagMs: 100, state: "unfed", reason: "no-roster-row-for-this-tree", lag: null });
});

test('returns unfed when roster lags behind ledger', () => {
  const r = feedLag({ rosterRows: [{ tree: 'tree-a', at: '2024-01-01T00:00:00Z' }], ledgerRows: [{ r: 'tree-a', at: '2024-01-01T00:00:00Z' }, { r: 'tree-a', at: '2024-01-01T00:00:10Z' }], self: 'tree-a', now: 1000, maxLagMs: 5000, minSpanMs: 100 });
  assert.deepEqual(r, { span: 10000, sessions: 0, newestEdit: 1704067210000, newestBind: 1704067200000, maxLagMs: 5000, state: "unfed", reason: "roster-lags-ledger", lag: 10000 });
});

test('returns ok when roster is fed within lag budget', () => {
  const r = feedLag({ rosterRows: [{ tree: 'tree-a', at: '2024-01-01T00:00:09Z' }], ledgerRows: [{ r: 'tree-a', at: '2024-01-01T00:00:00Z' }, { r: 'tree-a', at: '2024-01-01T00:00:10Z' }], self: 'tree-a', now: 1000, maxLagMs: 5000, minSpanMs: 100 });
  assert.deepEqual(r, { span: 10000, sessions: 0, newestEdit: 1704067210000, newestBind: 1704067209000, maxLagMs: 5000, state: "ok", reason: "fed", lag: 1000 });
});

test('returns ok when lag equals max lag budget exactly', () => {
  const r = feedLag({ rosterRows: [{ tree: 'tree-a', at: '2024-01-01T00:00:00Z' }], ledgerRows: [{ r: 'tree-a', at: '2024-01-01T00:00:00Z' }, { r: 'tree-a', at: '2024-01-01T00:00:10Z' }], self: 'tree-a', now: 1000, maxLagMs: 10000, minSpanMs: 100 });
  assert.deepEqual(r, { span: 10000, sessions: 0, newestEdit: 1704067210000, newestBind: 1704067200000, maxLagMs: 10000, state: "ok", reason: "fed", lag: 10000 });
});

test('counts only sessions belonging to this tree in ledger', () => {
  const r = feedLag({ rosterRows: [{ tree: 'tree-a', at: '2024-01-01T00:00:09Z' }], ledgerRows: [{ r: 'tree-a', at: '2024-01-01T00:00:00Z', s: 'sess-1' }, { r: 'tree-a', at: '2024-01-01T00:00:10Z', s: 'sess-2' }, { r: 'other', at: '2024-01-01T00:00:05Z', s: 'sess-3' }], self: 'tree-a', now: 1000, maxLagMs: 5000, minSpanMs: 100 });
  assert.deepEqual(r, { span: 10000, sessions: 2, newestEdit: 1704067210000, newestBind: 1704067209000, maxLagMs: 5000, state: "ok", reason: "fed", lag: 1000 });
});
