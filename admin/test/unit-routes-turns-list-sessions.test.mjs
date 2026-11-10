// Lists transcript files in a directory, newest first, capped at a limit (admin/routes/turns.mjs listSessions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listSessions } from '../routes/turns.mjs';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns absent when directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listSessions-'));
  try {
    const res = listSessions(join(dir, 'nope'));
    assert.deepEqual(res, { ok: false, reason: 'absent' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable with code when directory is a file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listSessions-'));
  const f = join(dir, 'afile');
  writeFileSync(f, 'x');
  try {
    const res = listSessions(f);
    assert.equal(res.ok, false);
    assert.match(res.reason, /^unreadable \(/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty files and total 0 for empty directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listSessions-'));
  try {
    const res = listSessions(dir);
    assert.deepEqual(res, { ok: true, files: [], total: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filters out non-jsonl files and returns total count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listSessions-'));
  writeFileSync(join(dir, 'a.jsonl'), 'x');
  writeFileSync(join(dir, 'b.jsonl'), 'y');
  writeFileSync(join(dir, 'c.txt'), 'z');
  try {
    const res = listSessions(dir);
    assert.equal(res.ok, true);
    assert.equal(res.total, 2);
    assert.equal(res.files.length, 2);
    assert.ok(res.files.every((p) => p.endsWith('.jsonl')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sorts files by mtime descending', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listSessions-'));
  const p1 = join(dir, 'old.jsonl');
  const p2 = join(dir, 'new.jsonl');
  writeFileSync(p1, 'x');
  writeFileSync(p2, 'y');
  const base = 1700000000000;
  utimesSync(p1, new Date(base - 10000), new Date(base - 10000));
  utimesSync(p2, new Date(base + 10000), new Date(base + 10000));
  try {
    const res = listSessions(dir);
    assert.equal(res.files[0], p2);
    assert.equal(res.files[1], p1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('caps limit at MAX_SESSIONS 50', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listSessions-'));
  const n = 60;
  for (let i = 0; i < n; i++) {
    writeFileSync(join(dir, `s${String(i).padStart(3, '0')}.jsonl`), 'x');
  }
  try {
    const res = listSessions(dir, 100);
    assert.equal(res.total, 60);
    assert.equal(res.files.length, 50);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses limit 10 when limit is undefined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listSessions-'));
  const n = 15;
  for (let i = 0; i < n; i++) {
    writeFileSync(join(dir, `s${String(i).padStart(2, '0')}.jsonl`), 'x');
  }
  try {
    const res = listSessions(dir);
    assert.equal(res.total, 15);
    assert.equal(res.files.length, 10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses limit 1 when limit is 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listSessions-'));
  const n = 5;
  for (let i = 0; i < n; i++) {
    writeFileSync(join(dir, `s${i}.jsonl`), 'x');
  }
  try {
    const res = listSessions(dir, 0);
    assert.equal(res.total, 5);
    assert.equal(res.files.length, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses limit 1 when limit is NaN', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listSessions-'));
  const n = 5;
  for (let i = 0; i < n; i++) {
    writeFileSync(join(dir, `s${i}.jsonl`), 'x');
  }
  try {
    const res = listSessions(dir, 'abc');
    assert.equal(res.total, 5);
    assert.equal(res.files.length, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns all files when count is below limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listSessions-'));
  const n = 3;
  for (let i = 0; i < n; i++) {
    writeFileSync(join(dir, `s${i}.jsonl`), 'x');
  }
  try {
    const res = listSessions(dir, 10);
    assert.equal(res.total, 3);
    assert.equal(res.files.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
