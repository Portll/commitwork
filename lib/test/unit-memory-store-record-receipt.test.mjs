// Persists a put() receipt as one memory_receipt row and reports ok (lib/memory-store.mjs recordReceipt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordReceipt } from '../memory-store.mjs';
import { open } from '../memory-store.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AT = '2025-05-06T07:08:09.000Z';
const NOW = '2026-03-04T05:06:07Z';
const NOW_ISO = '2026-03-04T05:06:07.000Z';
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);
const SELECT = `SELECT external_id, adapter, at, state, reason, stored_form,
  CAST(stored_coverage AS REAL) AS stored_coverage, content_sha256, stored_sha256, tags_sent,
  CAST(tags_stored_count AS INTEGER) AS tags_stored_count, CAST(truncated AS INTEGER) AS truncated,
  remote_id, CAST(was_update AS INTEGER) AS was_update, CAST(remote_version AS INTEGER) AS remote_version
  FROM memory_receipt ORDER BY external_id`;

const base = (over = {}) => ({
  external_id: 'rec-1', adapter: 'local', at: AT, state: 'verified', reason: null,
  storedForm: 'full', storedCoverage: 1, contentSha256: C, storedSha256: D,
  tagsSent: ['b', 'a'], tagsStoredCount: 2, truncated: false, wasUpdate: false, version: 1, ...over,
});

const row = (over = {}) => ({
  external_id: 'rec-1', adapter: 'local', at: AT, state: 'verified', reason: null, stored_form: 'full',
  stored_coverage: 1, content_sha256: C, stored_sha256: D, tags_sent: '["b","a"]', tags_stored_count: 2,
  truncated: 0, remote_id: null, was_update: 0, remote_version: 1, ...over,
});

const rowsOf = (db) => db.prepare(SELECT).all().map((x) => ({ ...x }));

function inStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'recordReceipt-'));
  const prev = process.env.CW_NOW;
  process.env.CW_NOW = NOW;
  try {
    const path = join(dir, 'memory.db');
    open({ path }).close();
    return fn(path);
  } finally {
    if (prev === undefined) delete process.env.CW_NOW;
    else process.env.CW_NOW = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeAndRead(r) {
  return inStore((path) => {
    const result = recordReceipt(r, { path });
    const db = open({ path });
    try {
      return { result, rows: rowsOf(db) };
    } finally {
      db.close();
    }
  });
}

test('writes one row holding every field of the receipt and returns ok true', () => {
  const { result, rows } = writeAndRead(base());
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(rows, [row()]);
});

test('stores truncated as 1, the id over remote_id, wasUpdate true as 1 and version over remote_version', () => {
  const { result, rows } = writeAndRead(base({
    truncated: true, id: 'remote-7', remote_id: 'ignored', wasUpdate: true, version: 3, remote_version: 9,
  }));
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(rows, [row({ truncated: 1, remote_id: 'remote-7', was_update: 1, remote_version: 3 })]);
});

test('uses the CW_NOW clock for an empty at, empty tags when tagsSent is missing, and the snake spellings', () => {
  const { result, rows } = writeAndRead(base({
    at: '', tagsSent: undefined, wasUpdate: undefined, was_update: true,
    version: undefined, remote_version: 4, remote_id: 'srv-4',
  }));
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(rows, [row({ at: NOW_ISO, tags_sent: '[]', was_update: 1, remote_version: 4, remote_id: 'srv-4' })]);
});

test('fills defaults and nulls for a bare receipt and keeps a null wasUpdate over a snake was_update', () => {
  const { result, rows } = writeAndRead({
    external_id: 'bare', adapter: 'local', at: AT, reason: 'no writer scope', wasUpdate: null, was_update: true,
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(rows, [{
    external_id: 'bare', adapter: 'local', at: AT, state: 'failed', reason: 'no writer scope',
    stored_form: 'unknown', stored_coverage: null, content_sha256: null, stored_sha256: null,
    tags_sent: '[]', tags_stored_count: null, truncated: 0, remote_id: null, was_update: null,
    remote_version: null,
  }]);
});

test('returns ok false with the thrown message and writes no row when reading the receipt throws', () => {
  const r = Object.defineProperty(base(), 'tagsSent', { get() { throw new Error('tags exploded'); } });
  const { result, rows } = writeAndRead(r);
  assert.deepEqual(result, { ok: false, reason: 'receipt not recorded: tags exploded' });
  assert.deepEqual(rows, []);
});

test('reports error as the reason when the thrown error has an empty message', () => {
  const r = Object.defineProperty(base(), 'tagsSent', { get() { throw new Error(''); } });
  const { result, rows } = writeAndRead(r);
  assert.deepEqual(result, { ok: false, reason: 'receipt not recorded: error' });
  assert.deepEqual(rows, []);
});

test('writes through a caller-supplied connection and leaves it open for the caller', () => {
  inStore((path) => {
    const db = open({ path });
    try {
      assert.deepEqual(recordReceipt(base({ external_id: 'one' }), { db, path }), { ok: true });
      assert.deepEqual(recordReceipt(base({ external_id: 'two', truncated: true }), { db, path }), { ok: true });
      assert.deepEqual(rowsOf(db), [row({ external_id: 'one' }), row({ external_id: 'two', truncated: 1 })]);
    } finally {
      db.close();
    }
  });
});
