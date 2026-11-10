// Classifies the local memory store file as absent, uninitialised or ok (bin/memory-query.mjs localState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localState } from '../memory-query.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PAGE = 512;
const ABSENT_REASON = 'no store file \u2014 nothing has ever been written here, which is not the same as an empty store';
const UNINIT_REASON =
  'the file exists but holds no memory_record table \u2014 the memory store has never been written at this path. ' +
  'Check that CW_MEMORY_DB/CW_DB point where the writer writes; monitor/commitwork.db is the taxonomy database and shares this default filename.';

const varint = (n) => (n < 128 ? [n] : [0x80 | (n >> 7), n & 0x7f]);

function sqliteWithTables(names) {
  const pages = names.length + 1;
  const buf = Buffer.alloc(pages * PAGE, 0);
  buf.write('SQLite format 3', 0, 'latin1');
  buf.writeUInt16BE(PAGE, 16);
  buf.set([1, 1, 0, 64, 32, 32], 18);
  buf.writeUInt32BE(1, 24);
  buf.writeUInt32BE(pages, 28);
  buf.writeUInt32BE(1, 40);
  buf.writeUInt32BE(4, 44);
  buf.writeUInt32BE(1, 56);
  buf.writeUInt32BE(1, 92);
  buf.writeUInt32BE(3045000, 96);
  buf[100] = 13;
  buf.writeUInt16BE(names.length, 103);
  let top = PAGE;
  names.forEach((name, i) => {
    const cols = [Buffer.from('table'), Buffer.from(name), Buffer.from(name), Buffer.from([i + 2]), Buffer.from(`CREATE TABLE ${name}(id)`)];
    const types = cols.flatMap((c, j) => (j === 3 ? [1] : varint(c.length * 2 + 13)));
    const record = Buffer.concat([Buffer.from([types.length + 1, ...types]), ...cols]);
    const cell = Buffer.concat([Buffer.from([...varint(record.length), i + 1]), record]);
    top -= cell.length;
    cell.copy(buf, top);
    buf.writeUInt16BE(top, 108 + 2 * i);
  });
  buf.writeUInt16BE(top, 105);
  for (let pg = 1; pg < pages; pg++) {
    buf[pg * PAGE] = 13;
    buf.writeUInt16BE(PAGE, pg * PAGE + 5);
  }
  return buf;
}

function inTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'localState-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns absent with the no-store reason when the file at the explicit path does not exist', () => {
  inTempDir((dir) => {
    const p = join(dir, 'nope.db');
    assert.deepEqual(localState({ env: {}, path: p }), { state: 'absent', path: p, bytes: null, reason: ABSENT_REASON });
  });
});

test('uses the explicit path rather than CW_MEMORY_DB when both are given', () => {
  inTempDir((dir) => {
    const p = join(dir, 'explicit.db');
    const r = localState({ env: { CW_MEMORY_DB: join(dir, 'from-env.db') }, path: p });
    assert.deepEqual(r, { state: 'absent', path: p, bytes: null, reason: ABSENT_REASON });
  });
});

test('falls back to CW_MEMORY_DB ahead of CW_DB when path is null', () => {
  inTempDir((dir) => {
    const p = join(dir, 'memory.db');
    const r = localState({ env: { CW_MEMORY_DB: p, CW_DB: join(dir, 'shared.db') }, path: null });
    assert.deepEqual(r, { state: 'absent', path: p, bytes: null, reason: ABSENT_REASON });
  });
});

test('falls back to CW_DB when path is null and CW_MEMORY_DB is empty', () => {
  inTempDir((dir) => {
    const p = join(dir, 'shared.db');
    const r = localState({ env: { CW_MEMORY_DB: '', CW_DB: p }, path: null });
    assert.deepEqual(r, { state: 'absent', path: p, bytes: null, reason: ABSENT_REASON });
  });
});

test('rethrows a stat fault other than ENOENT instead of reporting absent', () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, 'plain'), 'x');
    const p = join(dir, 'plain', 'store.db');
    assert.throws(() => localState({ env: {}, path: p }), { name: 'Error', message: `ENOTDIR: not a directory, stat '${p}'` });
  });
});

test('throws file is not a database when the file exists but is not SQLite', () => {
  inTempDir((dir) => {
    const p = join(dir, 'zeros.db');
    writeFileSync(p, Buffer.alloc(128, 0));
    assert.throws(() => localState({ env: {}, path: p }), { name: 'Error', message: 'file is not a database' });
  });
});

test('reports ok with receiptsTable true when the store holds memory_record and memory_receipt', () => {
  inTempDir((dir) => {
    const p = join(dir, 'both.db');
    writeFileSync(p, sqliteWithTables(['memory_record', 'memory_receipt']));
    const r = localState({ env: {}, path: p });
    assert.deepEqual(r, { state: 'ok', path: p, bytes: 3 * PAGE, receiptsTable: true, reason: null });
  });
});

test('reports ok with receiptsTable false when the env store holds memory_record only', () => {
  inTempDir((dir) => {
    const p = join(dir, 'record-only.db');
    writeFileSync(p, sqliteWithTables(['memory_record']));
    const r = localState({ env: { CW_MEMORY_DB: p }, path: null });
    assert.deepEqual(r, { state: 'ok', path: p, bytes: 2 * PAGE, receiptsTable: false, reason: null });
  });
});

test('reports uninitialised when the store has tables but no memory_record', () => {
  inTempDir((dir) => {
    const p = join(dir, 'taxonomy.db');
    writeFileSync(p, sqliteWithTables(['taxonomy_node', 'memory_receipt']));
    const r = localState({ env: {}, path: p });
    assert.deepEqual(r, { state: 'uninitialised', path: p, bytes: 3 * PAGE, reason: UNINIT_REASON });
  });
});
