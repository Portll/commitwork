// Maps file rows to sets of sessions by attribution state (bin/lib/touch-attribution.mjs claimants).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimants } from '../lib/touch-attribution.mjs';

test('returns empty sets when no rows match the file', () => {
  const rows = [{ f: 'other.mjs', s: 'sess1', n: 'abc', t: 'edit' }];
  const result = claimants(rows, 'target.mjs');
  assert.deepEqual(result, { standing: [], superseded: [], unknown: [], touched: [] });
});

test('classifies a single hunk claim as standing when no later rows exist', () => {
  const rows = [{ f: 'a.mjs', s: 'alice', n: 'h1', h: null, at: '2024-01-01T00:00:00Z', t: 'edit' }];
  const result = claimants(rows, 'a.mjs');
  assert.deepEqual(result, { standing: ["alice"], superseded: [], unknown: [], touched: ["alice"] });
});

test('classifies a claim as superseded when a later row replaces its written text', () => {
  const rows = [
    { f: 'a.mjs', s: 'alice', n: 'h1', h: null, at: '2024-01-01T00:00:00Z', t: 'edit' },
    { f: 'a.mjs', s: 'bob', n: 'h2', h: 'h1', at: '2024-01-01T01:00:00Z', t: 'edit' },
  ];
  const result = claimants(rows, 'a.mjs');
  assert.deepEqual(result, { standing: ["bob"], superseded: ["alice"], unknown: [], touched: ["alice", "bob"] });
});

test('classifies a claim as unknown when a later whole-file write follows it', () => {
  const rows = [
    { f: 'a.mjs', s: 'alice', n: 'h1', h: null, at: '2024-01-01T00:00:00Z', t: 'edit' },
    { f: 'a.mjs', s: 'bob', n: null, h: null, at: '2024-01-01T01:00:00Z', t: 'write' },
  ];
  const result = claimants(rows, 'a.mjs');
  assert.deepEqual(result, { standing: ["alice"], superseded: [], unknown: [], touched: ["alice", "bob"] });
});

test('includes sessions with non-claim rows in touched but not in standing', () => {
  const rows = [
    { f: 'a.mjs', s: 'alice', n: 'h1', h: null, at: '2024-01-01T00:00:00Z', t: 'edit' },
    { f: 'a.mjs', s: 'bob', n: null, h: null, at: '2024-01-01T01:00:00Z', t: 'bash' },
  ];
  const result = claimants(rows, 'a.mjs');
  assert.deepEqual(result, { standing: ["alice"], superseded: [], unknown: [], touched: ["alice", "bob"] });
});

test('sorts session arrays alphabetically across all state buckets', () => {
  const rows = [
    { f: 'a.mjs', s: 'zeta', n: 'h1', h: null, at: '2024-01-01T00:00:00Z', t: 'edit' },
    { f: 'a.mjs', s: 'alpha', n: 'h2', h: null, at: '2024-01-01T01:00:00Z', t: 'edit' },
    { f: 'a.mjs', s: 'mid', n: 'h3', h: null, at: '2024-01-01T02:00:00Z', t: 'edit' },
  ];
  const result = claimants(rows, 'a.mjs');
  assert.deepEqual(result, { standing: ["alpha", "mid", "zeta"], superseded: [], unknown: [], touched: ["alpha", "mid", "zeta"] });
});

test('handles multiple claims where some are superseded and others remain standing', () => {
  const rows = [
    { f: 'a.mjs', s: 'alice', n: 'h1', h: null, at: '2024-01-01T00:00:00Z', t: 'edit' },
    { f: 'a.mjs', s: 'bob', n: 'h2', h: 'h1', at: '2024-01-01T01:00:00Z', t: 'edit' },
    { f: 'a.mjs', s: 'carol', n: 'h3', h: null, at: '2024-01-01T02:00:00Z', t: 'edit' },
  ];
  const result = claimants(rows, 'a.mjs');
  assert.deepEqual(result, { standing: ["bob", "carol"], superseded: ["alice"], unknown: [], touched: ["alice", "bob", "carol"] });
});

test('deduplicates sessions that appear in multiple rows of the same state', () => {
  const rows = [
    { f: 'a.mjs', s: 'alice', n: 'h1', h: null, at: '2024-01-01T00:00:00Z', t: 'edit' },
    { f: 'a.mjs', s: 'alice', n: 'h2', h: null, at: '2024-01-01T01:00:00Z', t: 'edit' },
  ];
  const result = claimants(rows, 'a.mjs');
  assert.deepEqual(result, { standing: ["alice"], superseded: [], unknown: [], touched: ["alice"] });
});
