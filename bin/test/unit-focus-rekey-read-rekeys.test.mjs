// Maps focus-rekey records by recordAt from a JSONL file (bin/focus-rekey.mjs readRekeys).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRekeys } from '../focus-rekey.mjs';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an empty map when the rekey file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRekeys-'));
  try {
    const r = readRekeys(dir);
    assert.deepEqual(r, new Map([]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty map when the file contains only blank lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRekeys-'));
  try {
    writeFileSync(join(dir, 'gate-focus-rekey.jsonl'), '\n\n  \n');
    const r = readRekeys(dir);
    assert.deepEqual(r, new Map([]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes a record whose kind is focus-rekey', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRekeys-'));
  try {
    const rec = { kind: 'focus-rekey', recordAt: '2024-01-01T00:00:00Z', value: 1 };
    writeFileSync(join(dir, 'gate-focus-rekey.jsonl'), JSON.stringify(rec) + '\n');
    const r = readRekeys(dir);
    assert.deepEqual(r, new Map([["2024-01-01T00:00:00Z", { kind: "focus-rekey", recordAt: "2024-01-01T00:00:00Z", value: 1 }]]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes a record whose kind is not focus-rekey', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRekeys-'));
  try {
    const rec = { kind: 'other', recordAt: '2024-01-01T00:00:00Z', value: 2 };
    writeFileSync(join(dir, 'gate-focus-rekey.jsonl'), JSON.stringify(rec) + '\n');
    const r = readRekeys(dir);
    assert.deepEqual(r, new Map([]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips a torn line that is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRekeys-'));
  try {
    const good = { kind: 'focus-rekey', recordAt: '2024-01-02T00:00:00Z', value: 3 };
    writeFileSync(join(dir, 'gate-focus-rekey.jsonl'), '{broken\n' + JSON.stringify(good) + '\n');
    const r = readRekeys(dir);
    assert.deepEqual(r, new Map([["2024-01-02T00:00:00Z", { kind: "focus-rekey", recordAt: "2024-01-02T00:00:00Z", value: 3 }]]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('keeps the last record when recordAt values collide', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRekeys-'));
  try {
    const a = { kind: 'focus-rekey', recordAt: 't1', value: 'first' };
    const b = { kind: 'focus-rekey', recordAt: 't1', value: 'second' };
    writeFileSync(join(dir, 'gate-focus-rekey.jsonl'), JSON.stringify(a) + '\n' + JSON.stringify(b) + '\n');
    const r = readRekeys(dir);
    assert.deepEqual(r, new Map([["t1", { kind: "focus-rekey", recordAt: "t1", value: "second" }]]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
