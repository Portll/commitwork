// Reads sessions from the spine store with status filtering and limit (admin/lib/overwatch-layer-read.mjs sessionsFromStore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionsFromStore } from '../lib/overwatch-layer-read.mjs';

const COLUMNS = 'id TEXT, plan_id TEXT, owner TEXT, agent TEXT, status TEXT, label TEXT, started_at TEXT, ended_at TEXT, pid INTEGER, last_seen TEXT';

function store(t, rows, { withIds = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-sessions-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'tasks.db');
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE sessions (${COLUMNS}${withIds ? ', ids TEXT' : ''})`);
  const insert = db.prepare(withIds
    ? 'INSERT INTO sessions (id, plan_id, owner, agent, status, label, started_at, ended_at, pid, last_seen, ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    : 'INSERT INTO sessions (id, plan_id, owner, agent, status, label, started_at, ended_at, pid, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const r of rows) {
    const values = [r.id, r.plan ?? 'p1', 'owner-x', 'claude', r.status, `label-${r.id}`, r.started, r.ended ?? null, r.pid ?? null, r.started];
    insert.run(...(withIds ? [...values, r.ids ?? null] : values));
  }
  db.close();
  return { dir, path };
}

const FLEET = [
  { id: 's-active-old', status: 'active', started: '2026-11-01T00:00:00Z', pid: 11, ids: '{"window":"w1"}' },
  { id: 's-completed', status: 'completed', started: '2026-11-02T00:00:00Z', ended: '2026-11-02T01:00:00Z' },
  { id: 's-reaped', status: 'reaped', started: '2026-11-03T00:00:00Z' },
  { id: 's-active-new', status: 'active', started: '2026-11-04T00:00:00Z', ids: 'not json' },
];
const ids = (r) => r.sessions.map((s) => s.id);

test('a missing store file is absent with no sessions, never a failure', (t) => {
  const { dir } = store(t, []);
  assert.deepEqual(sessionsFromStore({ path: join(dir, 'missing.db') }), { ok: true, absent: true, sessions: [] });
});

test('a file that is not a database is a failure naming the cause, not an empty fleet', (t) => {
  const { dir } = store(t, []);
  const path = join(dir, 'not-a-db');
  writeFileSync(path, 'x'.repeat(512));
  assert.deepEqual(sessionsFromStore({ path }), { ok: false, why: 'spine query failed: file is not a database' });
});

test('with no filter only active sessions are returned, newest first, with every field mapped', (t) => {
  const { path } = store(t, FLEET);
  const result = sessionsFromStore({ path });
  assert.equal(result.ok, true);
  assert.equal(result.absent, false);
  assert.deepEqual(ids(result), ['s-active-new', 's-active-old']);
  assert.deepEqual(result.sessions[1], {
    id: 's-active-old', planId: 'p1', owner: 'owner-x', agent: 'claude', status: 'active', label: 'label-s-active-old',
    startedAt: '2026-11-01T00:00:00Z', endedAt: null, pid: 11, lastSeen: '2026-11-01T00:00:00Z', ids: { window: 'w1' },
  });
});

test('all returns every session whatever its status', (t) => {
  const { path } = store(t, FLEET);
  assert.deepEqual(ids(sessionsFromStore({ path, all: true })), ['s-active-new', 's-reaped', 's-completed', 's-active-old']);
});

test('a status string returns that status only', (t) => {
  const { path } = store(t, FLEET);
  assert.deepEqual(ids(sessionsFromStore({ path, status: 'completed' })), ['s-completed']);
});

test('a status array returns every status in the set, so reaped sessions are not dropped from the closed population', (t) => {
  const { path } = store(t, FLEET);
  assert.deepEqual(ids(sessionsFromStore({ path, status: ['completed', 'reaped'] })), ['s-reaped', 's-completed']);
});

test('the filter applies before the 500-row limit, so newer closed sessions cannot push out an active one', (t) => {
  const closed = Array.from({ length: 501 }, (_, i) => ({ id: `c${i}`, status: 'completed', started: `2026-11-05T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z` }));
  const { path } = store(t, [{ id: 's-active-old', status: 'active', started: '2026-11-01T00:00:00Z' }, ...closed]);
  assert.deepEqual(ids(sessionsFromStore({ path })), ['s-active-old']);
  assert.equal(sessionsFromStore({ path, all: true }).sessions.length, 500);
});

test('an ids column that is null is unknown and one that is not JSON is unreadable, never an empty object', (t) => {
  const { path } = store(t, [
    { id: 'a', status: 'active', started: '2026-11-01T00:00:00Z' },
    { id: 'b', status: 'active', started: '2026-11-02T00:00:00Z', ids: 'not json' },
    { id: 'c', status: 'active', started: '2026-11-03T00:00:00Z', ids: '[1]' },
  ]);
  assert.deepEqual(sessionsFromStore({ path }).sessions.map((s) => [s.id, s.ids]), [
    ['c', { unreadable: 'ids column is not an object' }],
    ['b', { unreadable: 'ids column is not valid JSON' }],
    ['a', null],
  ]);
});

test('a store without the ids column is degraded with a migration hint, not an empty fleet', (t) => {
  const { path } = store(t, FLEET, { withIds: false });
  assert.deepEqual(sessionsFromStore({ path }), { ok: false, why: 'this spine store predates the ids column — restart the overwatch layer to migrate it' });
});

test('with no path the store is resolved from SPINE_TASKS_DB at call time', (t) => {
  const { path } = store(t, FLEET);
  const saved = { SPINE_TASKS_DB: process.env.SPINE_TASKS_DB, SUBSTRATE_TASKS_DB: process.env.SUBSTRATE_TASKS_DB };
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  delete process.env.SUBSTRATE_TASKS_DB;
  process.env.SPINE_TASKS_DB = path;
  assert.deepEqual(ids(sessionsFromStore()), ['s-active-new', 's-active-old']);
});
