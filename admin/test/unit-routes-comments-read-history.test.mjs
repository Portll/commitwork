// Reads the per-project sweep ledger and returns the last `limit` parsed JSON lines (admin/routes/comments.mjs readHistory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHistory } from '../routes/comments.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an empty array when the ledger file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHistory-'));
  try {
    process.env.CW_SLOP_SWEEP_LOG = join(dir, 'missing.jsonl');
    const result = readHistory(30, 'commitwork');
    assert.deepEqual(result, []);
  } finally {
    delete process.env.CW_SLOP_SWEEP_LOG;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the last limit entries from a ledger with more lines than limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHistory-'));
  try {
    const log = join(dir, 'ledger.jsonl');
    const lines = Array.from({ length: 5 }, (_, i) => JSON.stringify({ n: i }));
    writeFileSync(log, lines.join('\n') + '\n');
    process.env.CW_SLOP_SWEEP_LOG = log;
    const result = readHistory(3, 'commitwork');
    assert.deepEqual(result, [{ n: 2 }, { n: 3 }, { n: 4 }]);
  } finally {
    delete process.env.CW_SLOP_SWEEP_LOG;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns all entries when the ledger has fewer lines than limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHistory-'));
  try {
    const log = join(dir, 'ledger.jsonl');
    const lines = Array.from({ length: 2 }, (_, i) => JSON.stringify({ n: i }));
    writeFileSync(log, lines.join('\n') + '\n');
    process.env.CW_SLOP_SWEEP_LOG = log;
    const result = readHistory(10, 'commitwork');
    assert.deepEqual(result, [{ n: 0 }, { n: 1 }]);
  } finally {
    delete process.env.CW_SLOP_SWEEP_LOG;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips blank lines and unparseable lines while keeping valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHistory-'));
  try {
    const log = join(dir, 'ledger.jsonl');
    const content = JSON.stringify({ a: 1 }) + '\n\nnot-json\n' + JSON.stringify({ b: 2 }) + '\n';
    writeFileSync(log, content);
    process.env.CW_SLOP_SWEEP_LOG = log;
    const result = readHistory(30, 'commitwork');
    assert.deepEqual(result, [{ a: 1 }, { b: 2 }]);
  } finally {
    delete process.env.CW_SLOP_SWEEP_LOG;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws a descriptive error when the ledger is unreadable for a reason other than ENOENT', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHistory-'));
  try {
    const log = join(dir, 'ledger.jsonl');
    mkdirSync(log);
    process.env.CW_SLOP_SWEEP_LOG = log;
    assert.throws(() => readHistory(30, 'commitwork'), { name: "Error", message: "sweep history unreadable (EISDIR) \u2014 refusing to treat that as no history" });
  } finally {
    delete process.env.CW_SLOP_SWEEP_LOG;
    rmSync(dir, { recursive: true, force: true });
  }
});
