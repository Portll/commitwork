// Loads scanner annotations from a JSON store file (lib/launchlist-waiver.mjs loadScannerAnnotations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScannerAnnotations } from '../launchlist-waiver.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty records when the store file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadScannerAnnotations-'));
  try {
    const r = loadScannerAnnotations(join(dir, 'missing.json'));
    assert.deepEqual(r, { records: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable error when the store file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadScannerAnnotations-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, 'not json');
    const r = loadScannerAnnotations(p);
    assert.deepEqual(r, { error: "annotation store unreadable (unparseable)" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns not-an-object error when the store is a JSON array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadScannerAnnotations-'));
  try {
    const p = join(dir, 'arr.json');
    writeFileSync(p, JSON.stringify([1, 2]));
    const r = loadScannerAnnotations(p);
    assert.deepEqual(r, { error: "annotation store is not an object" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns not-an-object error when the store is a JSON string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadScannerAnnotations-'));
  try {
    const p = join(dir, 'str.json');
    writeFileSync(p, JSON.stringify('hello'));
    const r = loadScannerAnnotations(p);
    assert.deepEqual(r, { error: "annotation store is not an object" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty records when the store object has no scannerAnnotations key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadScannerAnnotations-'));
  try {
    const p = join(dir, 'nokey.json');
    writeFileSync(p, JSON.stringify({ other: 1 }));
    const r = loadScannerAnnotations(p);
    assert.deepEqual(r, { records: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the records list when scannerAnnotations is an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadScannerAnnotations-'));
  try {
    const p = join(dir, 'ok.json');
    writeFileSync(p, JSON.stringify({ scannerAnnotations: [{ id: 'a' }, { id: 'b' }] }));
    const r = loadScannerAnnotations(p);
    assert.deepEqual(r, { records: [{ id: "a" }, { id: "b" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns not-a-list error when scannerAnnotations is a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadScannerAnnotations-'));
  try {
    const p = join(dir, 'strval.json');
    writeFileSync(p, JSON.stringify({ scannerAnnotations: 'nope' }));
    const r = loadScannerAnnotations(p);
    assert.deepEqual(r, { error: "annotation store: scannerAnnotations is not a list" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns not-an-object error when the store is JSON null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadScannerAnnotations-'));
  try {
    const p = join(dir, 'null.json');
    writeFileSync(p, 'null');
    const r = loadScannerAnnotations(p);
    assert.deepEqual(r, { error: "annotation store is not an object" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
