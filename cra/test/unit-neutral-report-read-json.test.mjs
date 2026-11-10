// Parses a JSON file or returns a fallback on failure (cra/neutral-report.mjs readJSON).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJSON } from '../neutral-report.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns parsed object for valid json file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJSON-'));
  try {
    const p = join(dir, 'a.json');
    writeFileSync(p, JSON.stringify({ x: 1 }));
    const r = readJSON(p);
    assert.deepEqual(r, { x: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed array for valid json file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJSON-'));
  try {
    const p = join(dir, 'b.json');
    writeFileSync(p, JSON.stringify([1, 2, 3]));
    const r = readJSON(p);
    assert.deepEqual(r, [1, 2, 3]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed string for valid json file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJSON-'));
  try {
    const p = join(dir, 'c.json');
    writeFileSync(p, JSON.stringify('hello'));
    const r = readJSON(p);
    assert.equal(r, "hello");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed number for valid json file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJSON-'));
  try {
    const p = join(dir, 'd.json');
    writeFileSync(p, JSON.stringify(42));
    const r = readJSON(p);
    assert.equal(r, 42);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed null for json null file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJSON-'));
  try {
    const p = join(dir, 'e.json');
    writeFileSync(p, JSON.stringify(null));
    const r = readJSON(p);
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed boolean for valid json file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJSON-'));
  try {
    const p = join(dir, 'f.json');
    writeFileSync(p, JSON.stringify(true));
    const r = readJSON(p);
    assert.equal(r, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns default null fallback for missing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJSON-'));
  try {
    const p = join(dir, 'missing.json');
    const r = readJSON(p);
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns provided fallback for missing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJSON-'));
  try {
    const p = join(dir, 'missing2.json');
    const r = readJSON(p, { ok: true });
    assert.deepEqual(r, { ok: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns provided fallback for invalid json file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJSON-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, 'not json');
    const r = readJSON(p, 'fb');
    assert.equal(r, "fb");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns default null fallback for invalid json file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJSON-'));
  try {
    const p = join(dir, 'bad2.json');
    writeFileSync(p, '{broken');
    const r = readJSON(p);
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
