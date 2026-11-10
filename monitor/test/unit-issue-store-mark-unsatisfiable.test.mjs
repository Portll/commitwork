// Marks an issue unsatisfiable with a code and reason, recording the transition (monitor/issue-store.mjs markUnsatisfiable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markUnsatisfiable } from '../issue-store.mjs';

test('rejects an invalid unsatisfiable code', () => {
  const doc = { issues: { '1': { state: 'open' } }, events: [] };
  assert.throws(() => markUnsatisfiable(doc, '1', { code: 'bogus', reason: 'r', at: '2024-01-01T00:00:00Z' }), { name: 'Error', message: 'unsatisfiable code must be one of lane-retired|area-retired|blocker-unsatisfiable|manual' });
});

test('rejects a missing reason', () => {
  const doc = { issues: { '1': { state: 'open' } }, events: [] };
  assert.throws(() => markUnsatisfiable(doc, '1', { code: 'manual', reason: '', at: '2024-01-01T00:00:00Z' }), { name: 'Error', message: 'markUnsatisfiable requires a reason \u2014 an item leaves the queue with its reason or not at all' });
});

test('rejects a whitespace-only reason', () => {
  const doc = { issues: { '1': { state: 'open' } }, events: [] };
  assert.throws(() => markUnsatisfiable(doc, '1', { code: 'manual', reason: '   ', at: '2024-01-01T00:00:00Z' }), { name: 'Error', message: 'markUnsatisfiable requires a reason \u2014 an item leaves the queue with its reason or not at all' });
});

test('rejects an unknown issue id', () => {
  const doc = { issues: {}, events: [] };
  assert.throws(() => markUnsatisfiable(doc, 'missing', { code: 'manual', reason: 'r', at: '2024-01-01T00:00:00Z' }), { name: 'Error', message: 'unknown issue missing' });
});

test('rejects a closed issue', () => {
  const doc = { issues: { '1': { state: 'closed' } }, events: [] };
  assert.throws(() => markUnsatisfiable(doc, '1', { code: 'manual', reason: 'r', at: '2024-01-01T00:00:00Z' }), { name: 'Error', message: '1 is closed' });
});

test('rejects an already unsatisfiable issue', () => {
  const doc = { issues: { '1': { state: 'unsatisfiable', unsatisfiable: { code: 'manual' } } }, events: [] };
  assert.throws(() => markUnsatisfiable(doc, '1', { code: 'manual', reason: 'r', at: '2024-01-01T00:00:00Z' }), { name: 'Error', message: '1 is already unsatisfiable (manual)' });
});

test('rejects a claimed issue with an unexpired claim', () => {
  const doc = { issues: { '1': { state: 'claimed', claim: { by: 'alice', expiresAt: '2025-01-01T00:00:00Z' } } }, events: [] };
  assert.throws(() => markUnsatisfiable(doc, '1', { code: 'manual', reason: 'r', at: '2024-01-01T00:00:00Z' }), { name: 'Error', message: '1 is claimed by alice until 2025-01-01T00:00:00Z' });
});

test('marks an open issue unsatisfiable', () => {
  const doc = { issues: { '1': { state: 'open' } }, events: [] };
  const r = markUnsatisfiable(doc, '1', { code: 'manual', reason: 'no path', at: '2024-01-01T00:00:00Z' });
  assert.deepEqual(r, { state: "unsatisfiable", claim: null, unsatisfiable: { code: "manual", reason: "no path", at: "2024-01-01T00:00:00Z", by: null }, updatedAt: "2024-01-01T00:00:00Z" });
});

test('marks an expired claimed issue unsatisfiable', () => {
  const doc = { issues: { '1': { state: 'claimed', claim: { by: 'bob', expiresAt: '2023-01-01T00:00:00Z' } } }, events: [] };
  const r = markUnsatisfiable(doc, '1', { code: 'lane-retired', reason: 'lane gone', at: '2024-01-01T00:00:00Z' });
  assert.deepEqual(r, { state: "unsatisfiable", claim: null, unsatisfiable: { code: "lane-retired", reason: "lane gone", at: "2024-01-01T00:00:00Z", by: null }, updatedAt: "2024-01-01T00:00:00Z" });
});
