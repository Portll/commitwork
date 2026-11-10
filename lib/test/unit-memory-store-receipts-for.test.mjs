// Rows of memory_receipt for one external id, newest first, capped at a limit (lib/memory-store.mjs receiptsFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptsFor } from '../memory-store.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SQL = 'SELECT * FROM memory_receipt WHERE external_id = ? ORDER BY at DESC, id DESC LIMIT ?';

function fakeDb(rows) {
  const calls = [];
  const db = {
    closed: 0,
    prepare(sql) {
      calls.push({ sql });
      return {
        all: (...args) => {
          calls.push({ args });
          return rows;
        },
      };
    },
    close() {
      db.closed += 1;
    },
  };
  return { db, calls };
}

test('returns an empty array when no db is given and the store file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'receiptsFor-'));
  try {
    const r = receiptsFor('ext-1', { path: join(dir, 'memory.db') });
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('queries a passed db with the id as a string and the default limit of 100 and returns its rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'receiptsFor-'));
  try {
    const rows = [{ id: 2, external_id: '42', at: 'b' }, { id: 1, external_id: '42', at: 'a' }];
    const { db, calls } = fakeDb(rows);
    const r = receiptsFor(42, { db, path: join(dir, 'memory.db') });
    assert.equal(r, rows);
    assert.deepEqual(r, [{ id: 2, external_id: '42', at: 'b' }, { id: 1, external_id: '42', at: 'a' }]);
    assert.deepEqual(calls, [{ sql: SQL }, { args: ['42', 100] }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('does not close a db connection that the caller passed in', () => {
  const dir = mkdtempSync(join(tmpdir(), 'receiptsFor-'));
  try {
    const { db } = fakeDb([{ id: 7 }]);
    const r = receiptsFor('ext-7', { db, path: join(dir, 'memory.db') });
    assert.deepEqual(r, [{ id: 7 }]);
    assert.equal(db.closed, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('passes a custom limit of zero through to the query unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'receiptsFor-'));
  try {
    const { db, calls } = fakeDb([]);
    const r = receiptsFor('ext-1', { db, limit: 0, path: join(dir, 'memory.db') });
    assert.deepEqual(r, []);
    assert.deepEqual(calls, [{ sql: SQL }, { args: ['ext-1', 0] }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('passes a custom limit of one through to the query and returns the single row', () => {
  const dir = mkdtempSync(join(tmpdir(), 'receiptsFor-'));
  try {
    const { db, calls } = fakeDb([{ id: 3, external_id: 'abc' }]);
    const r = receiptsFor('abc', { db, limit: 1, path: join(dir, 'memory.db') });
    assert.deepEqual(r, [{ id: 3, external_id: 'abc' }]);
    assert.deepEqual(calls, [{ sql: SQL }, { args: ['abc', 1] }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('converts a null external id to the string null before querying', () => {
  const dir = mkdtempSync(join(tmpdir(), 'receiptsFor-'));
  try {
    const { db, calls } = fakeDb([{ id: 9 }]);
    const r = receiptsFor(null, { db, path: join(dir, 'memory.db') });
    assert.deepEqual(r, [{ id: 9 }]);
    assert.deepEqual(calls, [{ sql: SQL }, { args: ['null', 100] }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the store file exists but has no memory_receipt table', () => {
  const dir = mkdtempSync(join(tmpdir(), 'receiptsFor-'));
  try {
    const path = join(dir, 'memory.db');
    writeFileSync(path, Buffer.alloc(0));
    assert.throws(() => receiptsFor('ext-1', { path }), {
      name: 'Error',
      message: 'no such table: memory_receipt',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
