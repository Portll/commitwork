// Lists receipt identities grouped by external_id with receipt counts and last activity (admin/lib/memory-view.mjs listReceiptIdentities).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listReceiptIdentities } from '../lib/memory-view.mjs';
import { open } from '../../lib/memory-store.mjs';

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-receipt-ids-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function store(t, receipts) {
  const path = join(scratch(t), 'memory.db');
  const db = open({ path });
  const insert = db.prepare("INSERT INTO memory_receipt (external_id, adapter, at, state, stored_form) VALUES (?, 'local', ?, 'verified', 'full')");
  for (const [externalId, at] of receipts) insert.run(externalId, at);
  db.close();
  return path;
}

const at = (minute) => `2026-11-13T00:${String(minute).padStart(2, '0')}:00.000Z`;

test('a missing store file is absent with no rows', (t) => {
  assert.deepEqual(listReceiptIdentities({ path: join(scratch(t), 'missing.db') }),
    { state: 'absent', reason: 'no memory store exists at this path', rows: null });
});

test('a file that is not a database is unreadable with the cause, never absent or empty', (t) => {
  const path = join(scratch(t), 'junk.db');
  writeFileSync(path, 'x'.repeat(512));
  assert.deepEqual(listReceiptIdentities({ path }), { state: 'unreadable', reason: 'file is not a database', rows: null });
});

test('a path that will not open is unreadable with the error code', (t) => {
  const path = join(scratch(t), 'a-directory');
  mkdirSync(path);
  assert.deepEqual(listReceiptIdentities({ path }), { state: 'unreadable', reason: 'ERR_SQLITE_ERROR', rows: null });
});

test('a database without the receipt table is schema-absent, not unreadable', (t) => {
  const path = join(scratch(t), 'other.db');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE other (x)');
  db.close();
  assert.deepEqual(listReceiptIdentities({ path }), { state: 'schema-absent', reason: 'no such table: memory_receipt', rows: null });
});

test('an initialised store with no receipts is ok with an empty list', (t) => {
  assert.deepEqual(listReceiptIdentities({ path: store(t, []) }), { state: 'ok', reason: null, rows: [] });
});

test('receipts group by identity with their count and latest time, newest first, ties broken by identity', (t) => {
  const path = store(t, [
    ['id-c', at(3)], ['id-a', at(1)], ['id-c', at(4)], ['id-b', at(5)], ['id-a', at(5)], ['id-a', at(2)],
  ]);
  const result = listReceiptIdentities({ path });
  assert.equal(result.state, 'ok');
  assert.equal(result.reason, null);
  assert.deepEqual(result.rows.map((r) => ({ ...r })), [
    { external_id: 'id-a', receipts: 3, last_at: at(5) },
    { external_id: 'id-b', receipts: 1, last_at: at(5) },
    { external_id: 'id-c', receipts: 2, last_at: at(4) },
  ]);
});

test('limit keeps the newest identities', (t) => {
  const path = store(t, [['old', at(1)], ['mid', at(2)], ['new', at(3)]]);
  assert.deepEqual(listReceiptIdentities({ path, limit: 2 }).rows.map((r) => r.external_id), ['new', 'mid']);
});

test('with no limit at most 25 identities are listed', (t) => {
  const path = store(t, Array.from({ length: 26 }, (_, i) => [`id-${String(i).padStart(2, '0')}`, at(i)]));
  const rows = listReceiptIdentities({ path }).rows;
  assert.equal(rows.length, 25);
  assert.equal(rows[0].external_id, 'id-25');
  assert.ok(!rows.some((r) => r.external_id === 'id-00'));
});

test('with no path the store is resolved from CW_MEMORY_DB at call time', (t) => {
  const path = store(t, [['from-env', at(1)]]);
  const saved = process.env.CW_MEMORY_DB;
  t.after(() => { if (saved === undefined) delete process.env.CW_MEMORY_DB; else process.env.CW_MEMORY_DB = saved; });
  process.env.CW_MEMORY_DB = path;
  assert.deepEqual(listReceiptIdentities().rows.map((r) => r.external_id), ['from-env']);
  assert.deepEqual(listReceiptIdentities({ path: null }).rows.map((r) => r.external_id), ['from-env']);
});
