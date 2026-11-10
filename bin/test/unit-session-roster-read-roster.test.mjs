// Parses a JSONL session roster file into an array of row objects, skipping blank lines and dropping unparseable lines (bin/session-roster.mjs readRoster).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRoster } from '../session-roster.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an empty array when the roster file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRoster-'));
  try {
    const p = join(dir, 'missing.jsonl');
    assert.deepEqual(readRoster(p), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty array when the roster file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRoster-'));
  try {
    const p = join(dir, 'empty.jsonl');
    writeFileSync(p, '');
    assert.deepEqual(readRoster(p), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty array when the roster file contains only blank lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRoster-'));
  try {
    const p = join(dir, 'blank.jsonl');
    writeFileSync(p, '\n\n  \n\n');
    assert.deepEqual(readRoster(p), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed rows for a valid single-line roster', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRoster-'));
  try {
    const p = join(dir, 'one.jsonl');
    writeFileSync(p, '{"id":"a"}\n');
    assert.deepEqual(readRoster(p), [{ id: "a" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed rows for a valid multi-line roster', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRoster-'));
  try {
    const p = join(dir, 'multi.jsonl');
    writeFileSync(p, '{"id":"a"}\n{"id":"b"}\n{"id":"c"}\n');
    assert.deepEqual(readRoster(p), [{ id: "a" }, { id: "b" }, { id: "c" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('drops unparseable lines and keeps the valid ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRoster-'));
  try {
    const p = join(dir, 'torn.jsonl');
    writeFileSync(p, '{"id":"a"}\nnot-json\n{"id":"b"}\n');
    assert.deepEqual(readRoster(p), [{ id: "a" }, { id: "b" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty array when every line is unparseable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRoster-'));
  try {
    const p = join(dir, 'alltorn.jsonl');
    writeFileSync(p, 'garbage\nmore-garbage\n');
    assert.deepEqual(readRoster(p), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed rows when the file has no trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRoster-'));
  try {
    const p = join(dir, 'notrail.jsonl');
    writeFileSync(p, '{"id":"x"}');
    assert.deepEqual(readRoster(p), [{ id: "x" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
