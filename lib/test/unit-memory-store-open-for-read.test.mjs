// Opens a SQLite database in read-only mode or returns null if the file is missing (lib/memory-store.mjs openForRead).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openForRead } from '../memory-store.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openForRead-'));
  try {
    const missing = join(dir, 'nope.db');
    const r = openForRead({ path: missing });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Identity and behaviour, never the constructor's name: Node 26 renamed the class to Database and kept
// DatabaseSync as an alias, so `constructor.name` is 'DatabaseSync' on 22 and 'Database' on 26.
test('returns a database handle when the file exists', () => {
  // Arrange
  const dir = mkdtempSync(join(tmpdir(), 'openForRead-'));
  try {
    const p = join(dir, 'ok.db');
    writeFileSync(p, '');

    // Act
    const r = openForRead({ path: p });

    // Assert
    assert.ok(r instanceof DatabaseSync, 'a node:sqlite DatabaseSync handle');
    assert.deepEqual({ ...r.prepare('SELECT 1 AS one').get() }, { one: 1 }, 'and it answers a query');
    r.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the path is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openForRead-'));
  try {
    const sub = join(dir, 'subdir');
    mkdirSync(sub);
    assert.throws(() => openForRead({ path: sub }), { name: "Error", message: "disk I/O error" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws on permission denied instead of returning null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openForRead-'));
  try {
    const p = join(dir, 'locked.db');
    writeFileSync(p, '');
    chmodSync(p, 0o000);
    assert.throws(() => openForRead({ path: p }), { name: "Error", message: "unable to open database file" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
