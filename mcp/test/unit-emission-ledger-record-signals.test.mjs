// Records emission signals into a chained ledger (mcp/emission-ledger.mjs recordSignals).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordSignals } from '../emission-ledger.mjs';

test('returns zeroed counters when signals is empty', () => {
  const r = recordSignals({ jobId: 'j1', tool: 't1', source: 's1', signals: [] });
  assert.deepEqual(r, { rows: 0, chained: 0, unlinked: 0, failed: 0 });
});

test('returns zeroed counters when signals is undefined', () => {
  const r = recordSignals({ jobId: 'j1', tool: 't1', source: 's1' });
  assert.deepEqual(r, { rows: 0, chained: 0, unlinked: 0, failed: 0 });
});

test('returns failed count when path resolution throws', () => {
  const r = recordSignals({ jobId: 'j1', tool: 't1', source: 's1', signals: [{ id: 'r1', match: 'm1' }], path: 42 });
  assert.deepEqual(r, { rows: 0, chained: 0, unlinked: 0, failed: 1, errors: ["ERR_INVALID_ARG_TYPE"] });
});

test('returns failed count when path is null and emissionsPath throws', () => {
  const r = recordSignals({ jobId: 'j1', tool: 't1', source: 's1', signals: [{ id: 'r1', match: 'm1' }], path: null });
  assert.deepEqual(r, { rows: 1, chained: 1, unlinked: 0, failed: 0 });
});

test('returns zeroed counters when signals is an empty array with explicit path', () => {
  const r = recordSignals({ jobId: 'j1', tool: 't1', source: 's1', signals: [], path: '/tmp/x' });
  assert.deepEqual(r, { rows: 0, chained: 0, unlinked: 0, failed: 0 });
});

test('returns zeroed counters when signals is undefined with explicit path', () => {
  const r = recordSignals({ jobId: 'j1', tool: 't1', source: 's1', path: '/tmp/x' });
  assert.deepEqual(r, { rows: 0, chained: 0, unlinked: 0, failed: 0 });
});

test('returns zeroed counters when signals is empty array with null path', () => {
  const r = recordSignals({ jobId: 'j1', tool: 't1', source: 's1', signals: [], path: null });
  assert.deepEqual(r, { rows: 0, chained: 0, unlinked: 0, failed: 0 });
});

test('returns zeroed counters when signals is empty array with undefined path', () => {
  const r = recordSignals({ jobId: 'j1', tool: 't1', source: 's1', signals: [], path: undefined });
  assert.deepEqual(r, { rows: 0, chained: 0, unlinked: 0, failed: 0 });
});
