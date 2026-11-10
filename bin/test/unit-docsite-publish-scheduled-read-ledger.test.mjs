// Reads a JSON-lines ledger file, returning an array of parsed objects or an empty array if the file is missing. (bin/docsite-publish-scheduled.mjs readLedger).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLedger } from '../docsite-publish-scheduled.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an empty array when the ledger file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedger-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    assert.deepEqual(readLedger(p), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty array when the ledger file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedger-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, '');
    assert.deepEqual(readLedger(p), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed objects for a valid ledger with a trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedger-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, '{"a":1}\n{"b":2}\n');
    assert.deepEqual(readLedger(p), [{ a: 1 }, { b: 2 }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when the last line is incomplete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedger-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, '{"a":1}\n{"b":2');
    assert.throws(() => readLedger(p), { name: 'Error', message: `${p}: the last line is incomplete` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error naming the line when a line is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedger-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, '{"a":1}\nnot-json\n{"b":2}\n');
    assert.throws(() => readLedger(p), { name: 'Error', message: `${p}: line 2 is not JSON` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error naming the first line when it is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedger-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, 'bad\n{"b":2}\n');
    assert.throws(() => readLedger(p), { name: 'Error', message: `${p}: line 1 is not JSON` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
