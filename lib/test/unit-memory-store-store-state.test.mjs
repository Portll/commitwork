// Classifies the memory store file as absent, uninitialised, ready or unreadable (lib/memory-store.mjs storeState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeState } from '../memory-store.mjs';
import { open } from '../memory-store.mjs';
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ABSENT_WHY = 'no store file \u2014 nothing has been written here yet';
const TABLES = "SELECT name FROM sqlite_master WHERE type='table'";

function inTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'storeState-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildDb(file, sql) {
  const db = open({ path: file });
  try {
    db.exec(sql);
    return db.prepare(TABLES).all().length;
  } finally {
    db.close();
  }
}

function uninit(n) {
  return {
    state: 'uninitialised',
    why: `a database with no memory schema (${n} table(s), none of them memory_record)`,
    tables: n,
  };
}

test('A missing file at an explicit path is reported absent', () => {
  inTemp((dir) => {
    const r = storeState({ path: join(dir, 'missing.db'), env: {} });
    assert.deepEqual(r, { state: 'absent', why: ABSENT_WHY });
  });
});

test('A null path falls back to CW_MEMORY_DB from the given env', () => {
  inTemp((dir) => {
    const r = storeState({ path: null, env: { CW_MEMORY_DB: join(dir, 'env.db') } });
    assert.deepEqual(r, { state: 'absent', why: ABSENT_WHY });
  });
});

test('An explicit path wins over CW_MEMORY_DB and a store with both memory tables is ready', () => {
  inTemp((dir) => {
    const file = join(dir, 'full.db');
    const n = buildDb(file, 'CREATE TABLE IF NOT EXISTS memory_receipt (id INTEGER)');
    const r = storeState({ path: file, env: { CW_MEMORY_DB: join(dir, 'other.db') } });
    assert.deepEqual(r, { state: 'ready', why: null, tables: n });
  });
});

test('A path that fails to stat for a reason other than ENOENT is unreadable', () => {
  inTemp((dir) => {
    const file = join(dir, 'plain');
    writeFileSync(file, 'x');
    const p = join(file, 'child.db');
    let msg = '';
    try {
      statSync(p);
    } catch (e) {
      msg = e.message;
    }
    const r = storeState({ path: p });
    assert.deepEqual(r, { state: 'unreadable', why: `store present and not statable: ${msg}` });
  });
});

test('An empty file is a database with no tables and so is uninitialised', () => {
  inTemp((dir) => {
    const file = join(dir, 'empty.db');
    writeFileSync(file, '');
    assert.deepEqual(storeState({ path: file }), uninit(0));
  });
});

test('A store with memory_record but no memory_receipt is uninitialised', () => {
  inTemp((dir) => {
    const file = join(dir, 'record.db');
    const n = buildDb(file, 'CREATE TABLE IF NOT EXISTS memory_record (id INTEGER); DROP TABLE IF EXISTS memory_receipt');
    assert.deepEqual(storeState({ path: file }), uninit(n));
  });
});

test('A store with memory_receipt but no memory_record is uninitialised', () => {
  inTemp((dir) => {
    const file = join(dir, 'receipt.db');
    const n = buildDb(file, 'CREATE TABLE IF NOT EXISTS memory_receipt (id INTEGER); DROP TABLE IF EXISTS memory_record');
    assert.deepEqual(storeState({ path: file }), uninit(n));
  });
});

test('A file that is not a SQLite database is unreadable when opened', () => {
  inTemp((dir) => {
    const file = join(dir, 'garbage.db');
    writeFileSync(file, 'x'.repeat(4096));
    assert.deepEqual(storeState({ path: file }), {
      state: 'unreadable',
      why: 'store present and would not open: file is not a database',
    });
  });
});
