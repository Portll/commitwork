// Reads and parses the app-inventory baseline JSON file (monitor/app-inventory.mjs readBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBaseline } from '../app-inventory.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the baseline file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    process.env.CW_APPINV_BASELINE = join(dir, 'missing.json');
    assert.equal(readBaseline(), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_APPINV_BASELINE;
  }
});

test('returns the parsed object when the file contains a valid items array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, JSON.stringify({ items: [{ name: 'a' }] }));
    process.env.CW_APPINV_BASELINE = p;
    assert.deepEqual(readBaseline(), { items: [{ name: "a" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_APPINV_BASELINE;
  }
});

test('throws when the file contains JSON null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, 'null');
    process.env.CW_APPINV_BASELINE = p;
    assert.throws(() => readBaseline(), { name: 'Error', message: 'baseline has no items[]' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_APPINV_BASELINE;
  }
});

test('throws when the file contains an object without an items array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, JSON.stringify({ items: 'not-an-array' }));
    process.env.CW_APPINV_BASELINE = p;
    assert.throws(() => readBaseline(), { name: 'Error', message: 'baseline has no items[]' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_APPINV_BASELINE;
  }
});

test('throws when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, '{bad json');
    process.env.CW_APPINV_BASELINE = p;
    assert.throws(() => readBaseline(), { name: 'SyntaxError' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_APPINV_BASELINE;
  }
});

test('returns the parsed object when items is an empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, JSON.stringify({ items: [] }));
    process.env.CW_APPINV_BASELINE = p;
    assert.deepEqual(readBaseline(), { items: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_APPINV_BASELINE;
  }
});
