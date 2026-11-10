// Local memory-store state with counts plus the remote adapter status (bin/memory-query.mjs queryAdapters).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryAdapters } from '../memory-query.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

const DASH = '\u2014';
const ABSENT = `no store file ${DASH} nothing has ever been written here, which is not the same as an empty store`;
const UNINIT = `the file exists but holds no memory_record table ${DASH} the memory store has never been written at this path. Check that CW_MEMORY_DB/CW_DB point where the writer writes; monitor/commitwork.db is the taxonomy database and shares this default filename.`;
const NOCRED = `VELD_API_KEY unresolvable ${DASH} a configuration failure on this box, not the remote being down`;
const NULLS = { records: null, receipts: null, neverObserved: null };
const failFetch = async () => { throw new Error('network down'); };

function cred(ok) {
  const calls = [];
  const impl = (args) => {
    calls.push(args);
    return ok ? { ok: true, source: 'env' } : { ok: false, source: null };
  };
  return { calls, impl };
}

function varint(n) {
  return n < 128 ? [n] : [0x80 | (n >> 7), n & 0x7f];
}

function record(values) {
  const types = [];
  const bodies = [];
  for (const v of values) {
    if (typeof v === 'number') {
      types.push(1);
      bodies.push(Buffer.from([v]));
    } else {
      const b = Buffer.from(v, 'utf8');
      types.push(13 + 2 * b.length);
      bodies.push(b);
    }
  }
  const typeBytes = types.flatMap(varint);
  return Buffer.concat([Buffer.from([typeBytes.length + 1, ...typeBytes]), ...bodies]);
}

function sqliteFile(names) {
  const size = 4096;
  const pages = names.length + 1;
  const buf = Buffer.alloc(size * pages);
  Buffer.from('SQLite format 3\0', 'latin1').copy(buf, 0);
  buf.writeUInt16BE(size, 16);
  buf[18] = 1;
  buf[19] = 1;
  buf[21] = 64;
  buf[22] = 32;
  buf[23] = 32;
  buf.writeUInt32BE(1, 24);
  buf.writeUInt32BE(pages, 28);
  buf.writeUInt32BE(1, 40);
  buf.writeUInt32BE(4, 44);
  buf.writeUInt32BE(1, 56);
  buf.writeUInt32BE(1, 92);
  buf.writeUInt32BE(3045000, 96);
  let end = size;
  names.forEach((name, i) => {
    const rec = record(['table', name, name, i + 2, `CREATE TABLE ${name} (id INTEGER)`]);
    const cell = Buffer.concat([Buffer.from([...varint(rec.length), ...varint(i + 1)]), rec]);
    end -= cell.length;
    cell.copy(buf, end);
    buf.writeUInt16BE(end, 108 + 2 * i);
    buf[size * (i + 1)] = 13;
    buf.writeUInt16BE(size, size * (i + 1) + 5);
  });
  buf[100] = 13;
  buf.writeUInt16BE(names.length, 103);
  buf.writeUInt16BE(end, 105);
  return buf;
}

function inDir(fn) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'queryAdapters-'));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test('a missing store file named by CW_MEMORY_DB is absent and a failing credential is no-credential', inDir(async (dir) => {
  const p = join(dir, 'memory.db');
  const env = { CW_MEMORY_DB: p };
  const c = cred(false);
  const r = await queryAdapters({ env, fetchImpl: failFetch, credentialImpl: c.impl });
  assert.deepEqual(Object.keys(r), ['subcommand', 'local', 'remote']);
  assert.equal(r.subcommand, 'adapters');
  assert.deepEqual(r.local, { state: 'absent', path: p, bytes: null, reason: ABSENT, ...NULLS });
  assert.equal(r.remote.state, 'no-credential');
  assert.deepEqual(r.remote.credential, { present: false, source: null });
  assert.equal(r.remote.reachable, false);
  assert.equal(r.remote.reason, NOCRED);
  assert.deepEqual(c.calls, [{ env, report: false }]);
}));

test('CW_DB names the store when CW_MEMORY_DB is unset and a failed health check with a credential is unreachable', inDir(async (dir) => {
  const p = join(dir, 'other.db');
  const env = { CW_DB: p };
  const c = cred(true);
  const r = await queryAdapters({ env, fetchImpl: failFetch, credentialImpl: c.impl });
  assert.deepEqual(r.local, { state: 'absent', path: p, bytes: null, reason: ABSENT, ...NULLS });
  assert.equal(r.remote.state, 'unreachable');
  assert.deepEqual(r.remote.credential, { present: true, source: 'env' });
  assert.equal(r.remote.reachable, false);
  assert.equal(r.remote.reason.slice(0, 21), 'health check failed: ');
  assert.deepEqual(c.calls, [{ env, report: false }]);
}));

test('CW_MEMORY_DB takes precedence over CW_DB when both are set', inDir(async (dir) => {
  const a = join(dir, 'a.db');
  const b = join(dir, 'b.db');
  writeFileSync(b, sqliteFile(['memory_receipt']));
  const r = await queryAdapters({ env: { CW_MEMORY_DB: a, CW_DB: b }, fetchImpl: failFetch, credentialImpl: cred(true).impl });
  assert.deepEqual(r.local, { state: 'absent', path: a, bytes: null, reason: ABSENT, ...NULLS });
  assert.equal(r.remote.state, 'unreachable');
}));

test('a sqlite file holding only a taxonomy table is uninitialised with its byte size and null counts', inDir(async (dir) => {
  const p = join(dir, 'commitwork.db');
  writeFileSync(p, sqliteFile(['taxonomy_x']));
  const r = await queryAdapters({ env: { CW_MEMORY_DB: p }, fetchImpl: failFetch, credentialImpl: cred(true).impl });
  assert.deepEqual(r.local, { state: 'uninitialised', path: p, bytes: 8192, reason: UNINIT, ...NULLS });
  assert.equal(r.remote.state, 'unreachable');
  assert.equal(r.remote.reachable, false);
}));

test('a memory_receipt table without memory_record is still uninitialised', inDir(async (dir) => {
  const p = join(dir, 'memory.db');
  writeFileSync(p, sqliteFile(['taxonomy_x', 'memory_receipt']));
  const r = await queryAdapters({ env: { CW_MEMORY_DB: p }, fetchImpl: failFetch, credentialImpl: cred(false).impl });
  assert.deepEqual(r.local, { state: 'uninitialised', path: p, bytes: 12288, reason: UNINIT, ...NULLS });
  assert.equal(r.remote.state, 'no-credential');
  assert.equal(r.remote.reason, NOCRED);
}));

test('a store path inside a missing directory is reported absent at that full path', inDir(async (dir) => {
  const p = join(dir, 'missing', 'memory.db');
  const r = await queryAdapters({ env: { CW_MEMORY_DB: p }, fetchImpl: failFetch, credentialImpl: cred(true).impl });
  assert.deepEqual(r.local, { state: 'absent', path: p, bytes: null, reason: ABSENT, ...NULLS });
}));

test('a store path under a regular file rejects with the ENOTDIR stat error instead of reporting absent', inDir(async (dir) => {
  const f = join(dir, 'plain');
  writeFileSync(f, 'x'.repeat(4));
  const p = join(f, 'memory.db');
  const c = cred(true);
  await assert.rejects(
    queryAdapters({ env: { CW_MEMORY_DB: p }, fetchImpl: failFetch, credentialImpl: c.impl }),
    { name: 'Error', code: 'ENOTDIR', syscall: 'stat', path: p, message: `ENOTDIR: not a directory, stat '${p}'` },
  );
  assert.deepEqual(c.calls, []);
}));
