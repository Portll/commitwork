// Returns the parsed JSONL rows for a (subject, dimension) pair, or [] if the file is missing. (monitor/nondeterministic-store.mjs read).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read } from '../nondeterministic-store.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an empty array when the record file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'read-'));
  try {
    process.env.CW_NONDET_STORE = join(dir, 'store');
    const result = read('subject-a', 'dim-b');
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed rows in file order for a valid JSONL file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'read-'));
  try {
    const store = join(dir, 'store');
    const dimDir = join(store, 'dim-b');
    mkdirSync(dimDir, { recursive: true });
    const file = join(dimDir, 'subject-a.jsonl');
    const rows = [
      { subject: 'subject-a', dimension: 'dim-b', score: 0.1, detail: null, ts: '2024-01-01T00:00:00.000Z' },
      { subject: 'subject-a', dimension: 'dim-b', score: 0.5, detail: 'mid', ts: '2024-01-02T00:00:00.000Z' },
      { subject: 'subject-a', dimension: 'dim-b', score: 0.9, detail: 'high', ts: '2024-01-03T00:00:00.000Z' }
    ];
    writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    process.env.CW_NONDET_STORE = store;
    const result = read('subject-a', 'dim-b');
    assert.deepEqual(result, rows);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores trailing newlines and empty lines in the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'read-'));
  try {
    const store = join(dir, 'store');
    const dimDir = join(store, 'dim-c');
    mkdirSync(dimDir, { recursive: true });
    const file = join(dimDir, 'subject-b.jsonl');
    const row = { subject: 'subject-b', dimension: 'dim-c', score: 0.5, detail: null, ts: '2024-01-01T00:00:00.000Z' };
    writeFileSync(file, JSON.stringify(row) + '\n\n\n', 'utf8');
    process.env.CW_NONDET_STORE = store;
    const result = read('subject-b', 'dim-c');
    assert.deepEqual(result, [row]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error with line number when a line contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'read-'));
  try {
    const store = join(dir, 'store');
    const dimDir = join(store, 'dim-d');
    mkdirSync(dimDir, { recursive: true });
    const file = join(dimDir, 'subject-c.jsonl');
    const validRow = { subject: 'subject-c', dimension: 'dim-d', score: 0.1, detail: null, ts: '2024-01-01T00:00:00.000Z' };
    writeFileSync(file, JSON.stringify(validRow) + '\nnot-valid-json\n', 'utf8');
    process.env.CW_NONDET_STORE = store;
    assert.throws(() => read('subject-c', 'dim-d'), /nondeterministic-store: corrupt record at .*:2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sanitizes subject and dimension names by replacing unsafe characters with underscores', () => {
  const dir = mkdtempSync(join(tmpdir(), 'read-'));
  try {
    const store = join(dir, 'store');
    const dimDir = join(store, 'my_dim');
    mkdirSync(dimDir, { recursive: true });
    const file = join(dimDir, 'my_subject.jsonl');
    const row = { subject: 'my subject', dimension: 'my dim', score: 0.5, detail: null, ts: '2024-01-01T00:00:00.000Z' };
    writeFileSync(file, JSON.stringify(row) + '\n', 'utf8');
    process.env.CW_NONDET_STORE = store;
    const result = read('my subject', 'my dim');
    assert.deepEqual(result, [row]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty array for an empty file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'read-'));
  try {
    const store = join(dir, 'store');
    const dimDir = join(store, 'dim-e');
    mkdirSync(dimDir, { recursive: true });
    const file = join(dimDir, 'subject-d.jsonl');
    writeFileSync(file, '', 'utf8');
    process.env.CW_NONDET_STORE = store;
    const result = read('subject-d', 'dim-e');
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
