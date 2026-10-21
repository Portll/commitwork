// assigned-touched — Gate A's two ledgers, on an in-memory store so the real one is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { assignedTouched, planForSession, declaredBlockers } from '../lib/assigned-touched.mjs';

const SINCE = '2026-09-07T00:00:00.000Z';

function fixture(rows, sessions = []) {
  const db = new DatabaseSync(':memory:');
  db.exec('create table tasks (id text, plan_id text, goal text, status text, result text, updated_at text)');
  db.exec('create table sessions (id text, plan_id text, ids text, status text, started_at text)');
  for (const r of rows) {
    db.prepare('insert into tasks values (?,?,?,?,?,?)')
      .run(r.id, r.plan ?? 'p', r.goal ?? '', r.status ?? 'pending', r.result ?? null, r.updated ?? SINCE);
  }
  for (const s of sessions) {
    db.prepare('insert into sessions values (?,?,?,?,?)')
      .run(s.id, s.plan ?? null, s.ids ?? null, s.status ?? 'active', s.started ?? SINCE);
  }
  return db;
}

test('assignedTouched: pending tasks are assigned; settled ones are not', () => {
  const db = fixture([
    { id: '1', status: 'done' }, { id: '2', status: 'pending' }, { id: '3', status: 'abandoned' },
  ]);
  const r = assignedTouched('p', SINCE, { db });
  assert.deepEqual(r.assigned.map((t) => t.id), ['2']);
  assert.ok(r.touched.includes('1') && r.touched.includes('3'), 'settled counts as advanced');
});

test('assignedTouched: a task only counts as touched if its row actually moved', () => {
  const db = fixture([
    { id: '1', status: 'pending', updated: SINCE },                       // untouched
    { id: '2', status: 'pending', updated: '2026-09-08T10:00:00.000Z' },  // updated after `since`
    { id: '3', status: 'pending', result: 'landed abc1234' },             // result written
    { id: '4', status: 'active' },                                        // status moved off pending
  ]);
  const r = assignedTouched('p', SINCE, { db });
  assert.deepEqual(r.assigned.map((t) => t.id), ['1', '2', '3', '4']);
  assert.deepEqual(r.touched.sort(), ['2', '3', '4']);
  // and therefore Gate A strands exactly one
  const stranded = r.assigned.filter((t) => !r.touched.includes(t.id));
  assert.deepEqual(stranded.map((t) => t.id), ['1']);
});

test('assignedTouched: a missing `since` is UNREADABLE, never "everything touched"', () => {
  const db = fixture([{ id: '1', status: 'pending' }]);
  assert.equal(assignedTouched('p', undefined, { db }), undefined);
  assert.equal(assignedTouched('p', '', { db }), undefined);
  // without this the gate rubber-stamps: every task ever updated would read as advanced this session
});

test('assignedTouched: no plan and no tasks are ABSENT (null), not unreadable', () => {
  const db = fixture([{ id: '1', plan: 'other' }]);
  assert.equal(assignedTouched(null, SINCE, { db }), null);
  assert.equal(assignedTouched('p', SINCE, { db }), null, 'plan with no rows is absent');
});

test('planForSession: unknown session is null; a session with no plan is null', () => {
  const db = fixture([], [{ id: 's-1', plan: 'p' }, { id: 's-2', plan: null }]);
  assert.equal(planForSession('s-1', { db }), 'p');
  assert.equal(planForSession('s-2', { db }), null);
  assert.equal(planForSession('s-nope', { db }), null);
});

test('planForSession: the hook speaks TRANSCRIPT ids, substrate speaks s-<uuid>', () => {
  // The two namespaces never collide, so a direct id lookup misses every real hook invocation and
  // returns "no plan" — a clean-looking ABSENT that would leave Gate A permanently decorative.
  //
  // Synthetic, like every other uuid in this file. It was the authoring session's REAL transcript
  // id until 2026-09-13 — a live fleet identifier baked into a public-bound test as a fixture. The
  // publication boundary admits synthetic fixtures and never the private originals, and the two
  // existing redaction guards do not cover this: they scan for redacted CUSTOMER identities, and a
  // transcript id is fleet configuration, a different category they were never pointed at.
  const uuid = '11111111-2222-3333-4444-555555555555';
  const db = fixture([], [{ id: 's-real', plan: 'my-plan', ids: JSON.stringify({ transcript: uuid, cwd: '/x' }) }]);
  assert.equal(planForSession('s-real', { db }), 'my-plan', 'substrate-native id still resolves');
  assert.equal(planForSession(uuid, { db }), 'my-plan', 'transcript id resolves via ids');
});

test('planForSession: a LIKE wildcard in the payload cannot match a stranger\'s plan', () => {
  const db = fixture([], [{ id: 's-x', plan: 'secret-plan', ids: JSON.stringify({ transcript: 'aaaaaaaa-bbbb' }) }]);
  assert.equal(planForSession('%', { db }), null, 'a bare wildcard matches nothing');
  assert.equal(planForSession('________', { db }), null, 'underscores are wildcards in LIKE too');
});

test('planForSession: an active session wins over a stale one holding the same transcript', () => {
  const uuid = 'cccccccc-dddd-eeee-ffff-000011112222';
  const ids = JSON.stringify({ transcript: uuid });
  const db = fixture([], [
    { id: 's-old', plan: 'stale-plan', ids, status: 'reaped', started: '2026-09-01T00:00:00.000Z' },
    { id: 's-new', plan: 'live-plan', ids, status: 'active', started: '2026-09-09T00:00:00.000Z' },
  ]);
  assert.equal(planForSession(uuid, { db }), 'live-plan');
});

test('declaredBlockers: a blocker covers the items it NAMES and nothing else', () => {
  const msg = 'Landed three.\nTask 5 and task 6 are blocked: projects.json is held by a peer.\nTask 7 is next.';
  const b = declaredBlockers(msg, ['5', '6', '7']);
  assert.equal(b.length, 1);
  assert.deepEqual(b[0].covers, ['5', '6']);
  assert.ok(!b[0].covers.includes('7'), 'task 7 shares none of the named blocker');
});

test('declaredBlockers: an unattributed blocker covers NOTHING', () => {
  // "everything is blocked on the operator" is the general-purpose exit — a stopping trigger that
  // is always available is not a signal, so a blocker naming no item must not clear the gate.
  assert.deepEqual(declaredBlockers('All of this is blocked on your decision.', ['1', '2']), []);
  assert.deepEqual(declaredBlockers('', ['1']), []);
  assert.deepEqual(declaredBlockers(null, ['1']), []);
});

test('declaredBlockers: an id not in the assigned set cannot be covered', () => {
  const b = declaredBlockers('Task 9 is blocked on a peer.', ['1', '2']);
  assert.deepEqual(b, [], 'naming a task that was never assigned covers nothing');
});
