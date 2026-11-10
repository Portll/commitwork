// Opens a SQLite database in read-only mode or returns null if the file is missing (lib/memory-store.mjs openForRead).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openForRead } from '../memory-store.mjs';
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

test('returns a database handle when the file exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openForRead-'));
  try {
    const p = join(dir, 'ok.db');
    writeFileSync(p, '');
    const r = openForRead({ path: p });
    assert.equal(r.constructor.name, "DatabaseSync");
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
