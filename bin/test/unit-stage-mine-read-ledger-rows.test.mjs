// Reads and parses all ledger generation files into rows (bin/stage-mine.mjs readLedgerRows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLedgerRows } from '../stage-mine.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns parsed rows from a single ledger file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedgerRows-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, 'a\nb\n');
    const r = readLedgerRows(p);
    assert.deepEqual(r, { rows: [], torn: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when ledger file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedgerRows-'));
  try {
    const p = join(dir, 'missing.jsonl');
    const r = readLedgerRows(p);
    assert.deepEqual(r, { rows: [], torn: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when ledger file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedgerRows-'));
  try {
    const p = join(dir, 'empty.jsonl');
    writeFileSync(p, '');
    const r = readLedgerRows(p);
    assert.deepEqual(r, { rows: [], torn: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed rows from multiple ledger generations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedgerRows-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, 'x\n');
    const r = readLedgerRows(p);
    assert.deepEqual(r, { rows: [], torn: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed rows from ledger with single line no newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedgerRows-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, 'single');
    const r = readLedgerRows(p);
    assert.deepEqual(r, { rows: [], torn: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed rows from ledger with repeated lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedgerRows-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    const content = Array.from({ length: 5 }, () => 'row').join('\n') + '\n';
    writeFileSync(p, content);
    const r = readLedgerRows(p);
    assert.deepEqual(r, { rows: [], torn: 5 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
