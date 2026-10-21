// Archive the nondeterministic store to a destination, verifying the copy and optionally pruning source files only on a different device. (monitor/nondeterministic-store.mjs archive).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archive } from '../nondeterministic-store.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty result when store has no files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archive-'));
  try {
    const store = join(dir, 'store');
    const dest = join(dir, 'dest');
    mkdirSync(store, { recursive: true });
    process.env.CW_NONDET_STORE = store;
    const result = archive(dest);
    assert.deepEqual(result, { archived: 0, verified: 0, freedBytes: 0, sameDevice: null, note: 'store empty \u2014 nothing to archive' });
  } finally {
    delete process.env.CW_NONDET_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archives files and keeps source when prune is false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archive-'));
  try {
    const store = join(dir, 'store');
    const dest = join(dir, 'dest');
    mkdirSync(join(store, 'dim1'), { recursive: true });
    const file1 = join(store, 'dim1', 'subj1.jsonl');
    writeFileSync(file1, '{"subject":"subj1","dimension":"dim1","score":0.5,"detail":null,"ts":"2024-01-01T00:00:00Z"}\n');
    const file2 = join(store, 'dim1', 'subj2.jsonl');
    writeFileSync(file2, '{"subject":"subj2","dimension":"dim1","score":0.8,"detail":null,"ts":"2024-01-02T00:00:00Z"}\n');
    process.env.CW_NONDET_STORE = store;
    const result = archive(dest, { prune: false });
    assert.equal(result.archived, 2);
    assert.equal(result.verified, 2);
    assert.equal(result.freedBytes, 0);
    assert.equal(result.sameDevice, true);
    assert.equal(result.note, 'archived (verified copy); source kept \u2014 manual delete only');
    assert.ok(readFileSync(join(dest, 'dim1', 'subj1.jsonl'), 'utf8').includes('subj1'));
    assert.ok(readFileSync(join(dest, 'dim1', 'subj2.jsonl'), 'utf8').includes('subj2'));
    assert.ok(readFileSync(file1, 'utf8').includes('subj1'));
    assert.ok(readFileSync(file2, 'utf8').includes('subj2'));
  } finally {
    delete process.env.CW_NONDET_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses prune on same device and keeps source files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archive-'));
  try {
    const store = join(dir, 'store');
    const dest = join(dir, 'dest');
    mkdirSync(join(store, 'dim1'), { recursive: true });
    const file1 = join(store, 'dim1', 'subj1.jsonl');
    writeFileSync(file1, '{"subject":"subj1","dimension":"dim1","score":0.5,"detail":null,"ts":"2024-01-01T00:00:00Z"}\n');
    process.env.CW_NONDET_STORE = store;
    const result = archive(dest, { prune: true });
    assert.equal(result.archived, 1);
    assert.equal(result.verified, 1);
    assert.equal(result.freedBytes, 0);
    assert.equal(result.sameDevice, true);
    assert.equal(result.note, 'same device: prune would free 0 bytes and was refused; archive copied, source kept');
    assert.ok(readFileSync(file1, 'utf8').includes('subj1'));
    assert.ok(readFileSync(join(dest, 'dim1', 'subj1.jsonl'), 'utf8').includes('subj1'));
  } finally {
    delete process.env.CW_NONDET_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archives nested directory structure correctly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archive-'));
  try {
    const store = join(dir, 'store');
    const dest = join(dir, 'dest');
    mkdirSync(join(store, 'dim1', 'sub'), { recursive: true });
    const file1 = join(store, 'dim1', 'sub', 'subj1.jsonl');
    writeFileSync(file1, '{"subject":"subj1","dimension":"dim1","score":0.5,"detail":null,"ts":"2024-01-01T00:00:00Z"}\n');
    process.env.CW_NONDET_STORE = store;
    const result = archive(dest, { prune: false });
    assert.equal(result.archived, 1);
    assert.equal(result.verified, 1);
    assert.ok(readFileSync(join(dest, 'dim1', 'sub', 'subj1.jsonl'), 'utf8').includes('subj1'));
  } finally {
    delete process.env.CW_NONDET_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts only jsonl files but copies the whole store tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archive-'));
  try {
    const store = join(dir, 'store');
    const dest = join(dir, 'dest');
    mkdirSync(join(store, 'dim1'), { recursive: true });
    const file1 = join(store, 'dim1', 'subj1.jsonl');
    writeFileSync(file1, '{"subject":"subj1","dimension":"dim1","score":0.5,"detail":null,"ts":"2024-01-01T00:00:00Z"}\n');
    const file2 = join(store, 'dim1', 'notes.txt');
    writeFileSync(file2, 'not a record');
    process.env.CW_NONDET_STORE = store;
    const result = archive(dest, { prune: false });
    assert.equal(result.archived, 1);
    assert.equal(result.verified, 1);
    assert.ok(readFileSync(join(dest, 'dim1', 'subj1.jsonl'), 'utf8').includes('subj1'));
    assert.ok(readFileSync(join(dest, 'dim1', 'notes.txt'), 'utf8').includes('not a record'));
  } finally {
    delete process.env.CW_NONDET_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates dest directory if it does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archive-'));
  try {
    const store = join(dir, 'store');
    const dest = join(dir, 'new', 'dest');
    mkdirSync(join(store, 'dim1'), { recursive: true });
    const file1 = join(store, 'dim1', 'subj1.jsonl');
    writeFileSync(file1, '{"subject":"subj1","dimension":"dim1","score":0.5,"detail":null,"ts":"2024-01-01T00:00:00Z"}\n');
    process.env.CW_NONDET_STORE = store;
    const result = archive(dest, { prune: false });
    assert.equal(result.archived, 1);
    assert.equal(result.verified, 1);
    assert.ok(readFileSync(join(dest, 'dim1', 'subj1.jsonl'), 'utf8').includes('subj1'));
  } finally {
    delete process.env.CW_NONDET_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});
