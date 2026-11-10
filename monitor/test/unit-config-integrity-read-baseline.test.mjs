// Reads and validates the config-integrity baseline JSON file (monitor/config-integrity.mjs readBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBaseline } from '../config-integrity.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the baseline file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const sub = join(dir, 'store');
    mkdirSync(sub, { recursive: true });
    process.env.CW_CONFINT_BASELINE = join(sub, 'missing.json');
    const r = readBaseline();
    assert.equal(r, null);
  } finally {
    delete process.env.CW_CONFINT_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed object when items is an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const sub = join(dir, 'store');
    mkdirSync(sub, { recursive: true });
    const p = join(sub, 'baseline.json');
    writeFileSync(p, JSON.stringify({ items: [{ name: 'a' }] }));
    process.env.CW_CONFINT_BASELINE = p;
    const r = readBaseline();
    assert.deepEqual(r, { items: [{ name: "a" }] });
  } finally {
    delete process.env.CW_CONFINT_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when items is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const sub = join(dir, 'store');
    mkdirSync(sub, { recursive: true });
    const p = join(sub, 'baseline.json');
    writeFileSync(p, JSON.stringify({ items: 'not-an-array' }));
    process.env.CW_CONFINT_BASELINE = p;
    assert.throws(() => readBaseline(), { name: 'Error', message: 'baseline has no items[]' });
  } finally {
    delete process.env.CW_CONFINT_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const sub = join(dir, 'store');
    mkdirSync(sub, { recursive: true });
    const p = join(sub, 'baseline.json');
    writeFileSync(p, '{invalid json');
    process.env.CW_CONFINT_BASELINE = p;
    assert.throws(() => readBaseline(), { name: 'SyntaxError' });
  } finally {
    delete process.env.CW_CONFINT_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file contains null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const sub = join(dir, 'store');
    mkdirSync(sub, { recursive: true });
    const p = join(sub, 'baseline.json');
    writeFileSync(p, 'null');
    process.env.CW_CONFINT_BASELINE = p;
    assert.throws(() => readBaseline(), { name: 'Error', message: 'baseline has no items[]' });
  } finally {
    delete process.env.CW_CONFINT_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed object when items is an empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const sub = join(dir, 'store');
    mkdirSync(sub, { recursive: true });
    const p = join(sub, 'baseline.json');
    writeFileSync(p, JSON.stringify({ items: [] }));
    process.env.CW_CONFINT_BASELINE = p;
    const r = readBaseline();
    assert.deepEqual(r, { items: [] });
  } finally {
    delete process.env.CW_CONFINT_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});
