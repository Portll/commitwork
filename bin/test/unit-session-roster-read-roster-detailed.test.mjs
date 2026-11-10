// Parses a JSONL roster file into rows and counts torn lines (bin/session-roster.mjs readRosterDetailed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRosterDetailed } from '../session-roster.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty rows and zero torn when the roster file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRosterDetailed-'));
  try {
    const p = join(dir, 'missing.jsonl');
    assert.deepEqual(readRosterDetailed(p), { rows: [], torn: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty rows and zero torn for a file containing only blank lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRosterDetailed-'));
  try {
    const p = join(dir, 'blank.jsonl');
    writeFileSync(p, '\n\n  \n');
    assert.deepEqual(readRosterDetailed(p), { rows: [], torn: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parses valid JSON lines into rows with zero torn', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRosterDetailed-'));
  try {
    const p = join(dir, 'valid.jsonl');
    writeFileSync(p, '{"a":1}\n{"b":2}\n');
    assert.deepEqual(readRosterDetailed(p), { rows: [{ a: 1 }, { b: 2 }], torn: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts unparseable lines as torn while keeping valid rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRosterDetailed-'));
  try {
    const p = join(dir, 'torn.jsonl');
    writeFileSync(p, '{"ok":1}\nnot-json\n{"ok":2}\n');
    assert.deepEqual(readRosterDetailed(p), { rows: [{ ok: 1 }, { ok: 2 }], torn: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rethrows permission errors instead of treating them as an empty roster', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRosterDetailed-'));
  try {
    const p = join(dir, 'forbidden.jsonl');
    writeFileSync(p, 'x');
    assert.deepStrictEqual(readRosterDetailed(p), { rows: [], torn: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
