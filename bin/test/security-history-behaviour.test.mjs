import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareHistoryBehaviour } from '../../lib/security-history-behaviour.mjs';

const T = { workflowEditsPerWindow: 10, cadenceMs: 86_400_000 };
const NOW = '2026-01-10T00:00:00Z';
const subject = (over = {}) => ({
  id: 'repo-a',
  measured: true,
  botRegistration: null,
  workflowEditCount: 2,
  windowStart: '2026-01-01T00:00:00Z',
  windowEnd: '2026-01-01T10:00:00Z',
  suppressionExpiresAt: null,
  observedAt: '2026-01-09T12:00:00Z',
  ...over,
});
const snap = (subjects, over = {}) => ({ source: 'github-api', observedAt: '2026-01-09T12:00:00Z', subjects, ...over });
const run = (b, a, over = {}) => compareHistoryBehaviour({ before: snap(b), after: snap(a), now: NOW, thresholds: T, ...over });

test('identical measured snapshots give no changes and no unknowns', () => {
  assert.deepEqual(run([subject()], [subject()]), { changes: [], unknowns: [] });
});

test('a bot registration that changes is reported with prior and current kept apart', () => {
  const r = run([subject({ botRegistration: 'app-1' })], [subject({ botRegistration: 'app-2' })]);
  assert.deepEqual(r.changes, [{ id: 'repo-a', kind: 'bot-registration', prior: { botRegistration: 'app-1' }, current: { botRegistration: 'app-2' } }]);
  assert.equal(run([subject()], [subject({ botRegistration: 'app-9' })]).changes[0].current.botRegistration, 'app-9');
});

test('a workflow-edit burst crosses the declared threshold and carries its window as the denominator', () => {
  const r = run([subject({ workflowEditCount: 10 })], [subject({ workflowEditCount: 25 })]);
  assert.deepEqual(r.changes, [{
    id: 'repo-a',
    kind: 'workflow-edit-burst',
    prior: { workflowEditCount: 10 },
    current: { workflowEditCount: 25 },
    count: 25,
    threshold: 10,
    windowStart: '2026-01-01T00:00:00Z',
    windowEnd: '2026-01-01T10:00:00Z',
    windowMs: 36_000_000,
    editsPerHour: 2.5,
  }]);
});

test('no burst at the threshold, nor when the count was already over it', () => {
  assert.deepEqual(run([subject({ workflowEditCount: 3 })], [subject({ workflowEditCount: 10 })]).changes, []);
  assert.deepEqual(run([subject({ workflowEditCount: 11 })], [subject({ workflowEditCount: 30 })]).changes, []);
});

test('the threshold is the declared one, not a built-in default', () => {
  const b = [subject({ workflowEditCount: 3 })];
  const a = [subject({ workflowEditCount: 6 })];
  assert.equal(run(b, a).changes.length, 0);
  assert.equal(run(b, a, { thresholds: { ...T, workflowEditsPerWindow: 5 } }).changes[0].kind, 'workflow-edit-burst');
});

test('a missing edit count makes the burst unknown without hiding other changes', () => {
  const r = run([subject({ workflowEditCount: null, botRegistration: 'x' })], [subject({ workflowEditCount: 40, botRegistration: 'y' })]);
  assert.deepEqual(r.changes.map((c) => c.kind), ['bot-registration']);
  assert.deepEqual(r.unknowns, [{ id: 'repo-a', scope: 'workflow-edit-burst', reason: 'edit-count-missing' }]);
});

test('an empty window gives no rate: the burst is unknown', () => {
  const w = { windowStart: '2026-01-01T00:00:00Z', windowEnd: '2026-01-01T00:00:00Z' };
  const r = run([subject({ ...w, workflowEditCount: 0 })], [subject({ ...w, workflowEditCount: 50 })]);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.unknowns, [{ id: 'repo-a', scope: 'workflow-edit-burst', reason: 'empty-window' }]);
});

test('a suppression that has lapsed by now and was live before is newly expired', () => {
  const r = run([subject({ suppressionExpiresAt: '2026-01-09T20:00:00Z' })], [subject({ suppressionExpiresAt: '2026-01-09T20:00:00Z' })]);
  assert.deepEqual(r.changes, [{
    id: 'repo-a',
    kind: 'suppression-expired',
    prior: { suppressionExpiresAt: '2026-01-09T20:00:00Z', observedAt: '2026-01-09T12:00:00Z' },
    current: { suppressionExpiresAt: '2026-01-09T20:00:00Z' },
    now: NOW,
  }]);
  assert.equal(run([subject()], [subject({ suppressionExpiresAt: NOW })]).changes[0].kind, 'suppression-expired');
});

test('a suppression already lapsed at the before observation, or still live now, is not newly expired', () => {
  assert.deepEqual(run([subject({ suppressionExpiresAt: '2026-01-05T00:00:00Z' })], [subject({ suppressionExpiresAt: '2026-01-05T00:00:00Z' })]).changes, []);
  assert.deepEqual(run([subject({ suppressionExpiresAt: '2026-02-01T00:00:00Z' })], [subject({ suppressionExpiresAt: '2026-02-01T00:00:00Z' })]).changes, []);
});

test('an observation fresh before and older than the cadence now is stale', () => {
  const b = [subject({ observedAt: '2026-01-07T00:00:00Z' })];
  const r = run(b, [subject({ observedAt: '2026-01-08T00:00:00Z' })], { before: snap(b, { observedAt: '2026-01-07T12:00:00Z' }) });
  assert.deepEqual(r.changes, [{
    id: 'repo-a',
    kind: 'observation-stale',
    prior: { observedAt: '2026-01-07T00:00:00Z' },
    current: { observedAt: '2026-01-08T00:00:00Z' },
    lastObservedAt: '2026-01-08T00:00:00Z',
    ageMs: 172_800_000,
    cadenceMs: 86_400_000,
  }]);
});

test('no stale transition when it was already stale before, or is within cadence now', () => {
  assert.deepEqual(run([subject({ observedAt: '2026-01-01T00:00:00Z' })], [subject({ observedAt: '2026-01-02T00:00:00Z' })]).changes, []);
  assert.deepEqual(run([subject()], [subject({ observedAt: '2026-01-09T00:00:00Z' })]).changes, []);
});

test('the cadence is the declared one', () => {
  const b = [subject({ observedAt: '2026-01-09T06:00:00Z' })];
  const a = [subject({ observedAt: '2026-01-09T06:00:00Z' })];
  assert.deepEqual(run(b, a).changes, []);
  assert.equal(run(b, a, { before: snap(b, { observedAt: '2026-01-09T06:30:00Z' }), thresholds: { ...T, cadenceMs: 3_600_000 } }).changes[0].kind, 'observation-stale');
});

test('absent and unmeasured subjects are unknown, never a change', () => {
  const r = run(
    [subject({ id: 'gone' }), subject({ id: 'dark-before', measured: false }), subject({ id: 'dark-after', botRegistration: 'x' })],
    [subject({ id: 'new', botRegistration: 'y' }), subject({ id: 'dark-before', botRegistration: 'z' }), { id: 'dark-after', measured: false }],
  );
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.unknowns, [
    { id: 'dark-after', scope: 'subject', reason: 'unmeasured-after' },
    { id: 'dark-before', scope: 'subject', reason: 'unmeasured-before' },
    { id: 'gone', scope: 'subject', reason: 'absent-after' },
    { id: 'new', scope: 'subject', reason: 'absent-before' },
  ]);
});

test('a changed source makes every subject unknown', () => {
  const r = compareHistoryBehaviour({
    before: snap([subject({ botRegistration: 'a' })]),
    after: snap([subject({ botRegistration: 'b' }), subject({ id: 'repo-b' })], { source: 'gitlab-api' }),
    now: NOW,
    thresholds: T,
  });
  assert.deepEqual(r, { changes: [], unknowns: [{ id: 'repo-a', scope: 'subject', reason: 'source-changed' }, { id: 'repo-b', scope: 'subject', reason: 'source-changed' }] });
});

test('a changed window makes the subject unknown and suppresses every change kind', () => {
  const r = run([subject({ botRegistration: 'a', workflowEditCount: 1 })], [subject({ botRegistration: 'b', workflowEditCount: 90, windowEnd: '2026-01-01T12:00:00Z' })]);
  assert.deepEqual(r, { changes: [], unknowns: [{ id: 'repo-a', scope: 'subject', reason: 'window-changed' }] });
});

test('one window instant written in two zones is the same window', () => {
  const r = run([subject({ windowStart: '2026-01-01T10:00:00+10:00' })], [subject({ windowStart: '2026-01-01T00:00:00Z' })]);
  assert.deepEqual(r, { changes: [], unknowns: [] });
});

test('extra input fields such as author identity never reach the output', () => {
  const r = run([subject({ botRegistration: 'a', author: 'Some Person <p@example.test>' })], [subject({ botRegistration: 'b', author: 'Other <o@example.test>' })]);
  assert.ok(!JSON.stringify(r).includes('example.test'));
});

test('output is identical whatever order subjects arrive in', () => {
  const b = [subject({ id: 'b', botRegistration: 'x' }), subject({ id: 'a', workflowEditCount: 1 }), subject({ id: 'c' })];
  const a = [subject({ id: 'c', measured: false }), subject({ id: 'a', workflowEditCount: 99 }), subject({ id: 'b', botRegistration: 'y' })];
  const one = run(b, a);
  assert.deepEqual(one, run([...b].reverse(), [...a].reverse()));
  assert.deepEqual(one.changes.map((c) => `${c.id}:${c.kind}`), ['a:workflow-edit-burst', 'b:bot-registration']);
});

test('several changes on one subject sort by kind', () => {
  const b = [subject({ botRegistration: 'a', workflowEditCount: 1, observedAt: '2026-01-07T00:00:00Z' })];
  const r = run(b, [subject({ botRegistration: 'b', workflowEditCount: 50, observedAt: '2026-01-08T00:00:00Z' })], { before: snap(b, { observedAt: '2026-01-07T12:00:00Z' }) });
  assert.deepEqual(r.changes.map((c) => c.kind), ['bot-registration', 'observation-stale', 'workflow-edit-burst']);
});

test('thresholds are required and must be positive integers', () => {
  const base = { before: snap([]), after: snap([]), now: NOW };
  assert.throws(() => compareHistoryBehaviour(base), /thresholds must be an object/);
  assert.throws(() => compareHistoryBehaviour({ ...base, thresholds: { cadenceMs: 1 } }), /workflowEditsPerWindow must be a positive integer/);
  assert.throws(() => compareHistoryBehaviour({ ...base, thresholds: { workflowEditsPerWindow: 1 } }), /cadenceMs must be a positive integer/);
  assert.throws(() => compareHistoryBehaviour({ ...base, thresholds: { workflowEditsPerWindow: 0, cadenceMs: 1 } }), /workflowEditsPerWindow/);
  assert.throws(() => compareHistoryBehaviour({ ...base, thresholds: { workflowEditsPerWindow: 2, cadenceMs: 1.5 } }), /cadenceMs/);
});

test('now is the clock and must be an instant', () => {
  assert.throws(() => run([], [], { now: undefined }), /now must be an ISO-8601 instant/);
  assert.throws(() => run([], [], { now: snap([]) }), /now must be an ISO-8601 instant/);
  assert.throws(() => run([], [], { now: '2026-01-10' }), /now must be an ISO-8601 instant/);
});

test('malformed snapshots and subjects are refused', () => {
  assert.throws(() => compareHistoryBehaviour({ before: null, after: snap([]), now: NOW, thresholds: T }), /before must be an object/);
  assert.throws(() => run([], [], { after: snap([], { source: '' }) }), /after\.source must be a non-empty string/);
  assert.throws(() => run([], [], { before: snap([], { observedAt: '2026/01/09' }) }), /before\.observedAt/);
  assert.throws(() => run([], [], { after: { source: 's', observedAt: NOW } }), /after\.subjects must be an array/);
  assert.throws(() => run([subject(), subject()], []), /duplicate subject id in before: repo-a/);
  assert.throws(() => run([{ ...subject(), id: '' }], []), /before\.subjects\[0\]\.id/);
  assert.throws(() => run([{ ...subject(), measured: 'yes' }], []), /measured must be a boolean/);
  assert.throws(() => run([subject({ botRegistration: 7 })], []), /botRegistration/);
  assert.throws(() => run([subject({ workflowEditCount: -1 })], []), /workflowEditCount/);
  assert.throws(() => run([subject({ windowStart: '2026-02-30T00:00:00Z' })], []), /windowStart must be an ISO-8601 instant/);
  assert.throws(() => run([], [subject({ suppressionExpiresAt: 'soon' })]), /after\.subjects\[0\]\.suppressionExpiresAt/);
  assert.throws(() => run([], [subject({ observedAt: undefined })]), /observedAt/);
});

test('an unmeasured subject is not read beyond id and measured', () => {
  assert.doesNotThrow(() => run([{ id: 'x', measured: false, windowStart: 'garbage' }], []));
});
