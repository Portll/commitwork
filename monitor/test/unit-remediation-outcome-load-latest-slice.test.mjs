// Loads the latest remediation history slice from a directory (monitor/remediation-outcome.mjs loadLatestSlice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLatestSlice } from '../remediation-outcome.mjs';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the history index file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadLatestSlice-'));
  try {
    mkdirSync(join(dir, 'history'));
    const r = loadLatestSlice(dir);
    assert.deepEqual(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the history index is an empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadLatestSlice-'));
  try {
    mkdirSync(join(dir, 'history'));
    writeFileSync(join(dir, 'history', 'index.json'), '[]');
    const r = loadLatestSlice(dir);
    assert.deepEqual(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the history index is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadLatestSlice-'));
  try {
    mkdirSync(join(dir, 'history'));
    writeFileSync(join(dir, 'history', 'index.json'), '{"a":1}');
    const r = loadLatestSlice(dir);
    assert.deepEqual(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the last index row has no file property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadLatestSlice-'));
  try {
    mkdirSync(join(dir, 'history'));
    writeFileSync(join(dir, 'history', 'index.json'), JSON.stringify([{ id: 1 }]));
    const r = loadLatestSlice(dir);
    assert.deepEqual(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the latest slice file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadLatestSlice-'));
  try {
    mkdirSync(join(dir, 'history'));
    writeFileSync(join(dir, 'history', 'index.json'), JSON.stringify([{ file: 'slice.json' }]));
    const r = loadLatestSlice(dir);
    assert.deepEqual(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed latest slice when the index and file exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadLatestSlice-'));
  try {
    mkdirSync(join(dir, 'history'));
    const slice = { version: 1, data: 'x'.repeat(10) };
    writeFileSync(join(dir, 'history', 'slice.json'), JSON.stringify(slice));
    writeFileSync(join(dir, 'history', 'index.json'), JSON.stringify([{ file: 'slice.json' }]));
    const r = loadLatestSlice(dir);
    assert.deepEqual(r, { version: 1, data: "xxxxxxxxxx" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the last entry when the index has multiple rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadLatestSlice-'));
  try {
    mkdirSync(join(dir, 'history'));
    const first = { n: 1 };
    const second = { n: 2 };
    writeFileSync(join(dir, 'history', 'a.json'), JSON.stringify(first));
    writeFileSync(join(dir, 'history', 'b.json'), JSON.stringify(second));
    writeFileSync(join(dir, 'history', 'index.json'), JSON.stringify([{ file: 'a.json' }, { file: 'b.json' }]));
    const r = loadLatestSlice(dir);
    assert.deepEqual(r, { n: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the index has a single row with no file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadLatestSlice-'));
  try {
    mkdirSync(join(dir, 'history'));
    writeFileSync(join(dir, 'history', 'index.json'), JSON.stringify([{ id: 42 }]));
    const r = loadLatestSlice(dir);
    assert.deepEqual(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
