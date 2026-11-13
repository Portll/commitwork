// computes changes and unknowns between two security history snapshots (lib/security-history-behaviour.mjs compareHistoryBehaviour).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareHistoryBehaviour } from '../security-history-behaviour.mjs';

const isoNow = '2023-01-01T00:00:00Z';
const thresholds = { workflowEditsPerWindow: 5, cadenceMs: 3600000 };
const baseSubject = (id, measured = true, bot = null, edits = 0, winStart = '2022-12-31T00:00:00Z', winEnd = '2022-12-31T01:00:00Z', observed = isoNow, suppression = null) => ({
  id,
  measured,
  botRegistration: bot,
  workflowEditCount: edits,
  windowStart: winStart,
  windowEnd: winEnd,
  observedAt: observed,
  suppressionExpiresAt: suppression,
});

test('throws when thresholds missing', () => {
  const input = { before: { source: 's', observedAt: isoNow, subjects: [] }, after: { source: 's', observedAt: isoNow, subjects: [] }, now: isoNow };
  assert.throws(() => compareHistoryBehaviour(input), { name: 'TypeError', message: 'thresholds must be an object' });
});

test('throws when thresholds is not an object', () => {
  const input = { before: { source: 's', observedAt: isoNow, subjects: [] }, after: { source: 's', observedAt: isoNow, subjects: [] }, now: isoNow, thresholds: 42 };
  assert.throws(() => compareHistoryBehaviour(input), { name: 'TypeError', message: 'thresholds must be an object' });
});

test('unknown when source changed between snapshots', () => {
  const before = { source: 'a', observedAt: isoNow, subjects: [baseSubject('x')] };
  const after = { source: 'b', observedAt: isoNow, subjects: [baseSubject('x')] };
  const input = { before, after, now: isoNow, thresholds };
  const result = compareHistoryBehaviour(input);
  assert.deepEqual(result, { changes: [], unknowns: [{ id: "x", scope: "subject", reason: "source-changed" }] });
});

test('unknown when subject absent before snapshot', () => {
  const before = { source: 's', observedAt: isoNow, subjects: [] };
  const after = { source: 's', observedAt: isoNow, subjects: [baseSubject('y')] };
  const input = { before, after, now: isoNow, thresholds };
  const result = compareHistoryBehaviour(input);
  assert.deepEqual(result, { changes: [], unknowns: [{ id: "y", scope: "subject", reason: "absent-before" }] });
});

test('unknown when subject absent after snapshot', () => {
  const before = { source: 's', observedAt: isoNow, subjects: [baseSubject('z')] };
  const after = { source: 's', observedAt: isoNow, subjects: [] };
  const input = { before, after, now: isoNow, thresholds };
  const result = compareHistoryBehaviour(input);
  assert.deepEqual(result, { changes: [], unknowns: [{ id: "z", scope: "subject", reason: "absent-after" }] });
});

test('unknown when subject unmeasured before snapshot', () => {
  const before = { source: 's', observedAt: isoNow, subjects: [{ id: 'u', measured: false }] };
  const after = { source: 's', observedAt: isoNow, subjects: [baseSubject('u')] };
  const input = { before, after, now: isoNow, thresholds };
  const result = compareHistoryBehaviour(input);
  assert.deepEqual(result, { changes: [], unknowns: [{ id: "u", scope: "subject", reason: "unmeasured-before" }] });
});

test('unknown when subject unmeasured after snapshot', () => {
  const before = { source: 's', observedAt: isoNow, subjects: [baseSubject('v')] };
  const after = { source: 's', observedAt: isoNow, subjects: [{ id: 'v', measured: false }] };
  const input = { before, after, now: isoNow, thresholds };
  const result = compareHistoryBehaviour(input);
  assert.deepEqual(result, { changes: [], unknowns: [{ id: "v", scope: "subject", reason: "unmeasured-after" }] });
});

test('detect bot registration change', () => {
  const before = { source: 's', observedAt: isoNow, subjects: [baseSubject('b', true, 'old')] };
  const after = { source: 's', observedAt: isoNow, subjects: [baseSubject('b', true, 'new')] };
  const input = { before, after, now: isoNow, thresholds };
  const result = compareHistoryBehaviour(input);
  assert.deepEqual(result, { changes: [{ id: "b", kind: "bot-registration", prior: { botRegistration: "old" }, current: { botRegistration: "new" } }], unknowns: [] });
});

test('detect workflow edit burst change', () => {
  const before = { source: 's', observedAt: isoNow, subjects: [baseSubject('w', true, null, 3, '2022-12-31T00:00:00Z', '2022-12-31T01:00:00Z')] };
  const after = { source: 's', observedAt: isoNow, subjects: [baseSubject('w', true, null, 7, '2022-12-31T00:00:00Z', '2022-12-31T01:00:00Z')] };
  const input = { before, after, now: isoNow, thresholds };
  const result = compareHistoryBehaviour(input);
  assert.deepEqual(result, { changes: [{ id: "w", kind: "workflow-edit-burst", prior: { workflowEditCount: 3 }, current: { workflowEditCount: 7 }, count: 7, threshold: 5, windowStart: "2022-12-31T00:00:00Z", windowEnd: "2022-12-31T01:00:00Z", windowMs: 3600000, editsPerHour: 7 }], unknowns: [] });
});

test('detect suppression expiration and stale observation', () => {
  const past = '2022-12-31T00:00:00Z';
  const before = {
    source: 's',
    observedAt: isoNow,
    subjects: [baseSubject('s1', true, null, 0, past, past, isoNow, '2022-12-31T00:30:00Z')],
  };
  const after = {
    source: 's',
    observedAt: isoNow,
    subjects: [baseSubject('s1', true, null, 0, past, past, isoNow, isoNow)],
  };
  const input = { before, after, now: isoNow, thresholds };
  const result = compareHistoryBehaviour(input);
  assert.deepEqual(result, { changes: [], unknowns: [{ id: "s1", scope: "workflow-edit-burst", reason: "empty-window" }] });
});
