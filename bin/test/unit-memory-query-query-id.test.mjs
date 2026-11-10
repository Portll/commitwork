// Local, remote and receipt-ledger report for one external_id (bin/memory-query.mjs queryId).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryId } from '../memory-query.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

const PS = 4096;
const varint = (n) => (n < 0x80 ? [n] : [(n >> 7) | 0x80, n & 0x7f]);
const record = (vals) => {
  const types = [];
  const bodies = vals.map((v) => {
    if (v === null) { types.push(0); return Buffer.alloc(0); }
    if (typeof v === 'number') { types.push(1); return Buffer.from([v]); }
    const b = Buffer.from(v, 'utf8');
    types.push(b.length * 2 + 13);
    return b;
  });
  const head = types.flatMap(varint);
  return Buffer.concat([Buffer.from([head.length + 1, ...head]), ...bodies]);
};
const cell = (rowid, vals) => {
  const p = record(vals);
  return Buffer.concat([Buffer.from([...varint(p.length), ...varint(rowid)]), p]);
};
const leaf = (cells, off) => {
  const page = Buffer.alloc(PS);
  let top = PS;
  cells.forEach((c, i) => {
    top -= c.length;
    c.copy(page, top);
    page.writeUInt16BE(top, off + 8 + i * 2);
  });
  page[off] = 13;
  page.writeUInt16BE(cells.length, off + 3);
  page.writeUInt16BE(top, off + 5);
  return page;
};
const buildDb = (path, tables) => {
  const pages = tables.map(([, , rows]) => leaf(rows.map((r) => cell(r[0], [null, ...r.slice(1)])), 0));
  const first = leaf(tables.map(([name, sql], i) => cell(i + 1, ['table', name, name, i + 2, sql])), 100);
  first.write('SQLite format 3', 0, 'latin1');
  first.writeUInt16BE(PS, 16);
  first.set([1, 1, 0, 64, 32, 32], 18);
  [[24, 1], [28, tables.length + 1], [40, 1], [44, 4], [56, 1], [92, 1], [96, 3045000]].forEach(([o, v]) => first.writeUInt32BE(v, o));
  writeFileSync(path, Buffer.concat([first, ...pages]));
};

const RECORD_SQL = 'CREATE TABLE memory_record (id INTEGER PRIMARY KEY, external_id TEXT, kind TEXT, type TEXT, content TEXT, body TEXT, payload TEXT, tags TEXT, meta TEXT, metadata TEXT, source TEXT, scope TEXT, content_hash TEXT, hash TEXT, version INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, at TEXT, state TEXT)';
const RECEIPT_SQL = 'CREATE TABLE memory_receipt (id INTEGER PRIMARY KEY, external_id TEXT, adapter TEXT, at TEXT, state TEXT, remote_id TEXT, stored_form TEXT, stored_coverage TEXT, reason TEXT, record_id INTEGER, content_hash TEXT, detail TEXT, payload TEXT, http_status INTEGER, status TEXT, attempt INTEGER, duration_ms INTEGER, error TEXT, created_at TEXT)';
const day = (d) => `2026-10-0${d}T00:00:00.000Z`;
const RECEIPTS = [
  [1, 'ext-1', 'veld', day(1), 'accepted', 'r-old'],
  [2, 'ext-1', 'veld', day(3), 'stored', 'r-new'],
  [3, 'ext-1', 'local', day(4), 'written', null],
  [4, 'ext-1', null, day(5), 'pending', null],
  [5, 'ext-2', 'local', day(6), 'written', null],
  [6, 'ext-2', null, day(7), 'pending', null],
  [7, 'ext-3', 'veld', day(8), 'stored', 'r-other'],
];

const REMOTE = { state: 'not-queryable', matches: null, reason: "veld exposes no lookup by external_id: GET /api/memory/{id} takes veld's own id, and tag recall is enumeration \u2014 a tag is not an identity" };
const NEVER = { source: 'local receipt ledger', state: 'never-observed', attempts: 0, reason: 'no remote receipt has ever been recorded for this identity \u2014 that is unknown, not clean' };
const LEDGER_SOURCE = 'local receipt ledger \u2014 what a past write was TOLD, never what the remote holds now';
const ABSENT_REASON = 'no store file \u2014 nothing has ever been written here, which is not the same as an empty store';
const UNINIT_REASON = 'the file exists but holds no memory_record table \u2014 the memory store has never been written at this path. Check that CW_MEMORY_DB/CW_DB point where the writer writes; monitor/commitwork.db is the taxonomy database and shares this default filename.';

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'queryId-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const absent = (id, path) => ({
  subcommand: 'id',
  external_id: id,
  local: { state: 'absent', path, bytes: null, reason: ABSENT_REASON, found: false, record: null },
  remote: REMOTE,
  remoteLedger: NEVER,
});
const okDb = (dir) => {
  const path = join(dir, 'memory.db');
  buildDb(path, [['memory_record', RECORD_SQL, []], ['memory_receipt', RECEIPT_SQL, RECEIPTS]]);
  return path;
};
const okLocal = (path) => ({ state: 'ok', path, bytes: 12288, receiptsTable: true, reason: null, found: false });

test('an empty, null, zero or undefined id is rejected before any store is read', () => {
  withDir((dir) => {
    const env = { CW_MEMORY_DB: join(dir, 'memory.db') };
    for (const id of ['', null, 0, undefined]) {
      assert.throws(() => queryId(id, { env }), { name: 'Error', message: '--id needs an external_id' });
    }
  });
});

test('a missing store file is reported absent with a never-observed ledger', () => {
  withDir((dir) => {
    const path = join(dir, 'nonexistent.db');
    assert.deepEqual(queryId('test-id', { env: { CW_MEMORY_DB: path } }), absent('test-id', path));
  });
});

test('a numeric or single-space id is kept as its string form', () => {
  withDir((dir) => {
    const path = join(dir, 'nonexistent.db');
    const env = { CW_MEMORY_DB: path };
    assert.deepEqual(queryId(12345, { env }), absent('12345', path));
    assert.deepEqual(queryId(' ', { env }), absent(' ', path));
  });
});

test('CW_MEMORY_DB wins over CW_DB and CW_DB is used when it is the only one set', () => {
  withDir((dir) => {
    const a = join(dir, 'a.db');
    const b = join(dir, 'b.db');
    assert.deepEqual(queryId('k', { env: { CW_MEMORY_DB: a, CW_DB: b } }), absent('k', a));
    assert.deepEqual(queryId('k', { env: { CW_DB: b } }), absent('k', b));
  });
});

test('a store file without a memory_record table is uninitialised even when receipts exist', () => {
  withDir((dir) => {
    const path = join(dir, 'commitwork.db');
    buildDb(path, [['taxonomy_node', 'CREATE TABLE taxonomy_node (id INTEGER PRIMARY KEY, label TEXT)', []], ['memory_receipt', RECEIPT_SQL, RECEIPTS]]);
    assert.deepEqual(queryId('ext-1', { env: { CW_MEMORY_DB: path } }), {
      subcommand: 'id',
      external_id: 'ext-1',
      local: { state: 'uninitialised', path, bytes: 12288, reason: UNINIT_REASON, found: false, record: null },
      remote: REMOTE,
      remoteLedger: NEVER,
    });
  });
});

test('the newest receipt from a non-local adapter becomes the remote ledger entry', () => {
  withDir((dir) => {
    const path = okDb(dir);
    const r = queryId('ext-1', { env: { CW_MEMORY_DB: path } });
    const { record, ...local } = r.local;
    assert.deepEqual({ ...r, local }, {
      subcommand: 'id',
      external_id: 'ext-1',
      local: okLocal(path),
      remote: REMOTE,
      remoteLedger: { source: LEDGER_SOURCE, adapter: 'veld', at: day(3), state: 'stored', storedForm: null, storedCoverage: null, remoteId: 'r-new', reason: null, attempts: 2 },
    });
  });
});

test('receipts only from the local adapter or no adapter leave the ledger never-observed', () => {
  withDir((dir) => {
    const path = okDb(dir);
    const r = queryId('ext-2', { env: { CW_MEMORY_DB: path } });
    const { record, ...local } = r.local;
    assert.deepEqual({ ...r, local }, { subcommand: 'id', external_id: 'ext-2', local: okLocal(path), remote: REMOTE, remoteLedger: NEVER });
  });
});
