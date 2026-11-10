// Per-adapter receipt-state tallies and the never-observed flag for one external_id (bin/memory-query.mjs queryReceipts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryReceipts } from '../memory-query.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

const PAGE = 4096;
const REMOTE = { state: 'not-queryable', reason: 'receipts are a local ledger; the memory-layer contract exposes no receipt surface' };
const ABSENT = 'no store file \u2014 nothing has ever been written here, which is not the same as an empty store';
const UNINIT = 'the file exists but holds no memory_record table \u2014 the memory store has never been written at this path. '
  + 'Check that CW_MEMORY_DB/CW_DB point where the writer writes; monitor/commitwork.db is the taxonomy database and shares this default filename.';
const RECEIPT_COLS = ['external_id', 'adapter', 'state', 'at', 'record_id', 'version', 'stored_form', 'stored_coverage',
  'remote_id', 'reason', 'content_sha256', 'sha256', 'bytes', 'content_bytes', 'stored_bytes', 'remote_bytes', 'remote_sha256',
  'attempt', 'attempts', 'http_status', 'status', 'detail', 'details', 'error', 'url', 'endpoint', 'project', 'project_source',
  'scope', 'user_id', 'latency_ms', 'duration_ms', 'dry_run', 'verified_at', 'created_at', 'updated_at', 'kind', 'note', 'meta'];
const RECORD_COLS = ['external_id', 'version', 'scope', 'project', 'memory_type', 'tags', 'content', 'content_sha256', 'bytes',
  'created_at', 'updated_at', 'deleted_at', 'source', 'title', 'summary', 'meta'];
const RECORDS = [['k1', 1], ['other', 1]];

function varint(n) {
  const out = [n % 128];
  for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128)) out.unshift((v % 128) | 0x80);
  return Buffer.from(out);
}

function record(values) {
  const types = values.map((v) => (v === null ? 0 : typeof v === 'number' ? 1 : Buffer.byteLength(v) * 2 + 13));
  const body = values.filter((v) => v !== null).map((v) => (typeof v === 'number' ? Buffer.from([v]) : Buffer.from(v)));
  const head = Buffer.concat(types.map(varint));
  return Buffer.concat([varint(head.length + 1), head, ...body]);
}

function leaf(rows, hdr) {
  const page = Buffer.alloc(PAGE);
  let top = PAGE;
  rows.forEach((values, i) => {
    const payload = record(values);
    const cell = Buffer.concat([varint(payload.length), varint(i + 1), payload]);
    top -= cell.length;
    cell.copy(page, top);
    page.writeUInt16BE(top, hdr + 8 + i * 2);
  });
  page[hdr] = 0x0d;
  page.writeUInt16BE(rows.length, hdr + 3);
  page.writeUInt16BE(top, hdr + 5);
  return page;
}

function writeDb(path, tables) {
  const master = tables.map(([name, cols], i) => ['table', name, name, i + 2, `CREATE TABLE ${name} (id INTEGER PRIMARY KEY, ${cols.join(', ')})`]);
  const pages = [leaf(master, 100), ...tables.map(([, , rows]) => leaf(rows.map((r) => [null, ...r]), 0))];
  const h = pages[0];
  h.write('SQLite format 3\x00', 0, 'latin1');
  h.writeUInt16BE(PAGE, 16);
  h.set([1, 1, 0, 64, 32, 32], 18);
  for (const [off, v] of [[24, 1], [28, pages.length], [40, 1], [44, 4], [56, 1], [92, 1], [96, 3045000]]) h.writeUInt32BE(v, off);
  writeFileSync(path, Buffer.concat(pages));
}

function receiptRows(list) {
  return list.map(([eid, adapter, state], i) => [eid, adapter, state, `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, eid === 'k1' ? 1 : 2]);
}

function inDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'queryReceipts-'));
  try {
    return fn(dir, join(dir, 'memory.db'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function okStore(list) {
  return inDir((dir, db) => {
    writeDb(db, [['memory_record', RECORD_COLS, RECORDS], ['memory_receipt', RECEIPT_COLS, receiptRows(list)]]);
    const r = queryReceipts('k1', { env: { CW_MEMORY_DB: db } });
    const { receipts, ...local } = r.local;
    return { r, receipts, local, db };
  });
}

const tally = (total, verified, acceptedUnverified, failed, dryRun, unknownState) => ({ total, verified, acceptedUnverified, failed, dryRun, unknownState });

test('An empty, null, undefined or zero external_id is refused with a usage error', () => {
  inDir((dir, db) => {
    for (const id of ['', null, undefined, 0]) {
      assert.throws(() => queryReceipts(id, { env: { CW_MEMORY_DB: db } }), { name: 'Error', message: '--receipts needs an external_id' });
    }
  });
});

test('A missing store file is absent, the id is stringified, and count and never-observed are withheld as null', () => {
  inDir((dir) => {
    const p = join(dir, 'nope.db');
    assert.deepEqual(queryReceipts(42, { env: { CW_MEMORY_DB: p } }), {
      subcommand: 'receipts',
      external_id: '42',
      local: { state: 'absent', path: p, bytes: null, reason: ABSENT, count: null, receipts: [], byAdapter: {} },
      neverObserved: null,
      remote: REMOTE,
    });
  });
});

test('A store file holding receipt rows but no memory_record table is uninitialised and none of its receipts are read', () => {
  inDir((dir, db) => {
    writeDb(db, [['taxonomy_term', ['label'], [['x']]], ['memory_receipt', RECEIPT_COLS, receiptRows([['k1', 'veld', 'verified']])]]);
    assert.deepEqual(queryReceipts('k1', { env: { CW_MEMORY_DB: db } }), {
      subcommand: 'receipts',
      external_id: 'k1',
      local: { state: 'uninitialised', path: db, bytes: 12288, reason: UNINIT, count: null, receipts: [], byAdapter: {} },
      neverObserved: null,
      remote: REMOTE,
    });
  });
});

test('A memory store with receipts only for other identities counts zero and reports this identity as never observed', () => {
  const { r, receipts, local, db } = okStore([['other', 'veld', 'verified'], ['other', 'local', 'failed']]);
  assert.deepEqual(local, { state: 'ok', path: db, bytes: 12288, receiptsTable: true, reason: null, count: 0, byAdapter: {} });
  assert.deepEqual(receipts, []);
  assert.equal(r.neverObserved, true);
  assert.equal(r.subcommand, 'receipts');
  assert.equal(r.external_id, 'k1');
  assert.deepEqual(r.remote, REMOTE);
});

test('Receipts are tallied per adapter with each declared state in its own bucket and an undeclared or miscased state as unknown', () => {
  const { r, local, db } = okStore([
    ['k1', 'veld', 'verified'], ['k1', 'veld', 'accepted-unverified'], ['k1', 'veld', 'failed'], ['k1', 'veld', 'failed'],
    ['k1', 'veld', 'dry-run'], ['k1', 'veld', 'Verified'], ['k1', 'local', 'verified'], ['other', 'veld', 'failed'],
  ]);
  assert.deepEqual(local, {
    state: 'ok', path: db, bytes: 12288, receiptsTable: true, reason: null, count: 7,
    byAdapter: { veld: tally(6, 1, 1, 2, 1, 1), local: tally(1, 1, 0, 0, 0, 0) },
  });
  assert.equal(r.neverObserved, false);
});

test('Dry-run receipts count once each as not attempted and never as failed', () => {
  const { r, local } = okStore([['k1', 'veld', 'dry-run'], ['k1', 'veld', 'dry-run'], ['k1', 'local', 'accepted-unverified']]);
  assert.equal(local.count, 3);
  assert.deepEqual(local.byAdapter, { veld: tally(2, 0, 0, 0, 2, 0), local: tally(1, 0, 1, 0, 0, 0) });
  assert.equal(r.neverObserved, false);
});
