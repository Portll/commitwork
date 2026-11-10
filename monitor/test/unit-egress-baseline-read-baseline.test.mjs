// Reads and parses the egress baseline JSON file, returning null if missing (monitor/egress-baseline.mjs readBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBaseline } from '../egress-baseline.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the baseline file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    process.env.CW_EGRESS_BASELINE = join(dir, 'missing.json');
    assert.equal(readBaseline(), null);
  } finally {
    delete process.env.CW_EGRESS_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed object when the file contains a valid baseline with items', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, JSON.stringify({ items: [{ name: 'a' }] }));
    process.env.CW_EGRESS_BASELINE = p;
    assert.deepEqual(readBaseline(), { items: [{ name: "a" }] });
  } finally {
    delete process.env.CW_EGRESS_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file contains JSON that is not an object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, 'null');
    process.env.CW_EGRESS_BASELINE = p;
    assert.throws(() => readBaseline(), { name: "Error", message: "baseline has no items[]" });
  } finally {
    delete process.env.CW_EGRESS_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the parsed object has no items property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, JSON.stringify({ foo: 1 }));
    process.env.CW_EGRESS_BASELINE = p;
    assert.throws(() => readBaseline(), { name: "Error", message: "baseline has no items[]" });
  } finally {
    delete process.env.CW_EGRESS_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when items is present but is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, JSON.stringify({ items: 'not-an-array' }));
    process.env.CW_EGRESS_BASELINE = p;
    assert.throws(() => readBaseline(), { name: "Error", message: "baseline has no items[]" });
  } finally {
    delete process.env.CW_EGRESS_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed object when items is an empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, JSON.stringify({ items: [] }));
    process.env.CW_EGRESS_BASELINE = p;
    assert.deepEqual(readBaseline(), { items: [] });
  } finally {
    delete process.env.CW_EGRESS_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});
