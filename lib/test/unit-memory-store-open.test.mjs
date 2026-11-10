// SQLite handle at a path, with parent dirs and schema created when writable (lib/memory-store.mjs open).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open } from '../memory-store.mjs';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const memoryTables = (db) =>
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_record'").all().map((r) => r.name);

test('A writable open creates the missing parent directory, the file and the memory_record table', () => {
  const dir = mkdtempSync(join(tmpdir(), 'open-'));
  try {
    const path = join(dir, 'sub', 'test.db');
    const db = open({ path });
    assert.equal(existsSync(join(dir, 'sub')), true);
    assert.equal(existsSync(path), true);
    assert.deepEqual(memoryTables(db), ['memory_record']);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A writable open creates several missing directory levels at once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'open-'));
  try {
    const path = join(dir, 'a', 'b', 'c', 'test.db');
    const db = open({ path, readOnly: false });
    assert.equal(existsSync(join(dir, 'a', 'b', 'c')), true);
    assert.equal(existsSync(path), true);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A writable open in a directory that already exists succeeds and creates the schema', () => {
  const dir = mkdtempSync(join(tmpdir(), 'open-'));
  try {
    const path = join(dir, 'test.db');
    const db = open({ path, readOnly: false });
    assert.equal(existsSync(path), true);
    assert.deepEqual(memoryTables(db), ['memory_record']);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Omitting readOnly gives a handle that can write and read back rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'open-'));
  try {
    const db = open({ path: join(dir, 'test.db') });
    db.exec('CREATE TABLE t (x INTEGER)');
    db.exec('INSERT INTO t VALUES (7)');
    assert.deepEqual(db.prepare('SELECT x FROM t').all().map((r) => r.x), [7]);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A read-only open with a missing parent directory throws and creates no directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'open-'));
  try {
    const path = join(dir, 'sub', 'test.db');
    assert.throws(() => open({ path, readOnly: true }), { name: 'Error', message: 'unable to open database file' });
    assert.equal(existsSync(join(dir, 'sub')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A read-only open of a missing file in an existing directory throws and creates no file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'open-'));
  try {
    const path = join(dir, 'test.db');
    assert.throws(() => open({ path, readOnly: true }), { name: 'Error', message: 'unable to open database file' });
    assert.equal(existsSync(path), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A read-only open of a database made writable earlier sees its table but rejects writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'open-'));
  try {
    const path = join(dir, 'test.db');
    open({ path }).close();
    const db = open({ path, readOnly: true });
    assert.deepEqual(memoryTables(db), ['memory_record']);
    assert.throws(() => db.exec('CREATE TABLE t (x INTEGER)'), {
      name: 'Error',
      message: 'attempt to write a readonly database',
    });
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A read-only open of an empty file does not create the schema', () => {
  const dir = mkdtempSync(join(tmpdir(), 'open-'));
  try {
    const path = join(dir, 'empty.db');
    writeFileSync(path, Buffer.alloc(0));
    const db = open({ path, readOnly: true });
    assert.deepEqual(memoryTables(db), []);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
