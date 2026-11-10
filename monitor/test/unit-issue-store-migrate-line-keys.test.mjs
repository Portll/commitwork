// Adoptions, collapses and skips from moving issues onto line-free keys (monitor/issue-store.mjs migrateLineKeys).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateLineKeys } from '../issue-store.mjs';

const T = 'sc:repo|src/a.js|rule|fp';
const L1 = `${T}|10`;
const L2 = `${T}|20`;
const L3 = `${T}|30`;
const AT = '2024-06-01T00:00:00.000Z';
const D1 = '2024-01-01T00:00:00.000Z';
const D2 = '2024-02-01T00:00:00.000Z';
const D3 = '2024-03-01T00:00:00.000Z';
const EMPTY = { adopted: [], collapsed: [], skipped: [] };

const issue = (id, key, over = {}) => ({
  id, source: { key, tool: 'scan' }, state: 'open', createdAt: D1, severity: 'med', evidence: [], deps: {}, claim: null, ...over,
});
const makeDoc = (...issues) => ({
  issues: Object.fromEntries(issues.map((i) => [i.id, i])),
  byKey: Object.fromEntries(issues.map((i) => [i.source?.key, i.id])),
  events: [],
});
const eventsOf = (doc) => doc.events.map((e) => [e.type, e.issueId, e.at, e.data]);

test('a single legacy issue adopts the line-free key and is migrated by default', () => {
  const doc = makeDoc(issue('A', L1));
  const r = migrateLineKeys(doc, [T], { at: AT });
  assert.deepEqual(r, { adopted: [{ id: 'A', from: L1, to: T }], collapsed: [], skipped: [] });
  assert.deepEqual(doc.issues.A.source, { key: T, tool: 'scan' });
  assert.deepEqual(doc.issues.A.priorKeys, [L1]);
  assert.equal(doc.issues.A.updatedAt, AT);
  assert.deepEqual(doc.byKey, { [T]: 'A' });
  assert.deepEqual(eventsOf(doc), [
    ['issue-key-migrated', 'A', AT, { from: L1, to: T, why: 'D12: identity is line-free; the line moved to anchor/anchorHistory' }],
  ]);
});

test('adoption keeps existing prior keys and does not repeat the old key', () => {
  const doc = makeDoc(issue('A', L1, { priorKeys: ['sc:old', L1] }));
  migrateLineKeys(doc, [T], { at: AT });
  assert.deepEqual(doc.issues.A.priorKeys, ['sc:old', L1]);
});

test('adoption leaves an index slot owned by another issue in place', () => {
  const doc = makeDoc(issue('A', L1));
  doc.byKey[L1] = 'Z';
  migrateLineKeys(doc, [T], { at: AT });
  assert.deepEqual(doc.byKey, { [L1]: 'Z', [T]: 'A' });
});

test('a dry run reports one adoption for a repeated target and changes nothing', () => {
  const doc = makeDoc(issue('A', L1));
  const before = structuredClone(doc);
  const r = migrateLineKeys(doc, [T, T], { at: AT, dryRun: true });
  assert.deepEqual(r, { adopted: [{ id: 'A', from: L1, to: T }], collapsed: [], skipped: [] });
  assert.deepEqual(doc, before);
});

test('two legacy issues collapse into the live one, which inherits the oldest date and worst severity', () => {
  const a = issue('A', L1, { createdAt: D3, priorKeys: ['sc:old-a'], reopenCount: 1, attemptCount: 5 });
  const b = issue('B', L2, {
    state: 'closed', severity: 'crit', priorKeys: ['sc:old-b'], reopenCount: 2, attemptCount: 1, suspect: true, claim: { by: 'bot' },
  });
  const doc = makeDoc(a, b);
  const r = migrateLineKeys(doc, [T], { at: AT });
  assert.deepEqual(r, { adopted: [], collapsed: [{ id: 'A', to: T, absorbed: ['B'], from: L1 }], skipped: [] });
  assert.deepEqual(a.priorKeys, ['sc:old-a', L1, 'sc:old-b', L2]);
  assert.deepEqual(a.source, { key: T, tool: 'scan' });
  assert.deepEqual(
    [a.createdAt, a.severity, a.reopenCount, a.suspect, a.attemptCount, a.updatedAt],
    [D1, 'crit', 2, true, 5, AT],
  );
  assert.deepEqual([b.state, b.closedAs, b.claim, b.updatedAt, b.source.key], ['closed', 'superseded', null, AT, L2]);
  assert.deepEqual(b.deps, { supersededBy: 'A' });
  assert.deepEqual(b.evidence, [
    { at: AT, tier: 'manual', detail: 'collapsed into A \u2014 same place under the line-free identity (D12)' },
  ]);
  assert.deepEqual(doc.byKey, { [L2]: 'B', [T]: 'A' });
  assert.deepEqual(eventsOf(doc), [
    ['issue-closed', 'B', AT, { closedAs: 'superseded', supersededBy: 'A', why: 'D12 collapse' }],
    ['issue-key-migrated', 'A', AT, { from: L1, to: T, absorbed: ['B'], inherited: { createdAt: D1, severity: 'crit' } }],
  ]);
});

test('three legacy issues collapse into the oldest live issue with the others absorbed in store order', () => {
  const doc = makeDoc(issue('A', L1, { createdAt: D3 }), issue('B', L2, { createdAt: D1 }), issue('C', L3, { createdAt: D2 }));
  const r = migrateLineKeys(doc, [T], { at: AT });
  assert.deepEqual(r, { adopted: [], collapsed: [{ id: 'B', to: T, absorbed: ['A', 'C'], from: L2 }], skipped: [] });
  const b = doc.issues.B;
  assert.deepEqual(b.priorKeys, [L2, L1, L3]);
  assert.deepEqual([b.createdAt, b.severity, b.reopenCount, b.suspect, b.attemptCount], [D1, 'med', 0, false, 0]);
  assert.deepEqual(doc.byKey, { [L1]: 'A', [T]: 'B', [L3]: 'C' });
  assert.deepEqual(doc.events.map((e) => [e.type, e.issueId]), [
    ['issue-closed', 'A'], ['issue-closed', 'C'], ['issue-key-migrated', 'B'],
  ]);
  assert.equal(doc.events[0].prevHash, null);
  assert.equal(doc.events[1].prevHash, doc.events[0].hash);
});

test('a dry run reports the collapse and changes nothing', () => {
  const doc = makeDoc(issue('A', L1, { createdAt: D2 }), issue('B', L2, { createdAt: D1, severity: 'high' }));
  const before = structuredClone(doc);
  const r = migrateLineKeys(doc, [T], { at: AT, dryRun: true });
  assert.deepEqual(r, { adopted: [], collapsed: [{ id: 'B', to: T, absorbed: ['A'], from: L2 }], skipped: [] });
  assert.deepEqual(doc, before);
});

test('a createdAt tie goes to the most evidence and then to the smallest id', () => {
  const seen = { at: D1, tier: 'manual', detail: 'seen' };
  const byEvidence = makeDoc(issue('A', L1, { severity: 'low' }), issue('B', L2, { severity: 'high', evidence: [seen] }));
  assert.deepEqual(migrateLineKeys(byEvidence, [T], { at: AT }), {
    adopted: [], collapsed: [{ id: 'B', to: T, absorbed: ['A'], from: L2 }], skipped: [],
  });
  assert.equal(byEvidence.issues.B.severity, 'high');
  const byId = makeDoc(issue('B', L1), issue('A', L2));
  assert.deepEqual(migrateLineKeys(byId, [T], { at: AT }), {
    adopted: [], collapsed: [{ id: 'A', to: T, absorbed: ['B'], from: L2 }], skipped: [],
  });
});

test('non-scanner targets are ignored and a target that still carries a line is skipped', () => {
  const doc = makeDoc(issue('A', L1));
  const before = structuredClone(doc);
  const r = migrateLineKeys(doc, [42, null, 'gh:a|b|c|d|5', L1, 'sc:a|b|c'], { at: AT });
  assert.deepEqual(r, { adopted: [], collapsed: [], skipped: [{ target: L1, why: 'target still carries a line' }] });
  assert.deepEqual(doc, before);
});

test('issues without a scanner key, issues already on the target and missing newKeys produce nothing', () => {
  const doc = makeDoc(issue('A', 'gh:1'), issue('B', 7), issue('C', 'x', { source: undefined }), issue('D', T));
  const before = structuredClone(doc);
  assert.deepEqual(migrateLineKeys(doc, [T], { at: AT }), EMPTY);
  assert.deepEqual(migrateLineKeys(doc, undefined), EMPTY);
  assert.deepEqual(migrateLineKeys(doc, null, { at: AT }), EMPTY);
  assert.deepEqual(doc, before);
});
