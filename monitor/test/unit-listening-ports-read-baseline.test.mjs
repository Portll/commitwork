// Reads the listening-ports baseline JSON file and validates its shape (monitor/listening-ports.mjs readBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBaseline } from '../listening-ports.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the baseline file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    process.env.CW_PORTS_BASELINE = join(dir, 'no-such-file.json');
    const r = readBaseline();
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed object when the file contains a valid baseline with items', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, JSON.stringify({ items: [{ port: 8080 }], generatedAt: '2025-01-01T00:00:00.000Z' }));
    process.env.CW_PORTS_BASELINE = p;
    const r = readBaseline();
    assert.deepEqual(r, { items: [{ port: 8080 }], generatedAt: "2025-01-01T00:00:00.000Z" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file contains JSON null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, 'null');
    process.env.CW_PORTS_BASELINE = p;
    assert.throws(() => readBaseline(), { name: "Error", message: "baseline has no items[]" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file contains an object without an items array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, JSON.stringify({ items: 'not-an-array' }));
    process.env.CW_PORTS_BASELINE = p;
    assert.throws(() => readBaseline(), { name: "Error", message: "baseline has no items[]" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file contains a JSON array instead of an object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, JSON.stringify([1, 2, 3]));
    process.env.CW_PORTS_BASELINE = p;
    assert.throws(() => readBaseline(), { name: "Error", message: "baseline has no items[]" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, '{not valid json');
    process.env.CW_PORTS_BASELINE = p;
    assert.throws(() => readBaseline(), { name: "SyntaxError", message: "Expected property name or '}' in JSON at position 1 (line 1 column 2)" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed object when items is an empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, JSON.stringify({ items: [] }));
    process.env.CW_PORTS_BASELINE = p;
    const r = readBaseline();
    assert.deepEqual(r, { items: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
