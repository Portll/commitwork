// Reads and validates the scanner binaries baseline JSON (monitor/scanner-binary.mjs readBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBaseline } from '../scanner-binary.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the baseline file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    process.env.CW_SCANNER_BASELINE = join(dir, 'missing.json');
    assert.equal(readBaseline(), null);
  } finally {
    delete process.env.CW_SCANNER_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed object when the baseline has a tools object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, JSON.stringify({ tools: { git: '1.0' } }));
    process.env.CW_SCANNER_BASELINE = p;
    assert.deepEqual(readBaseline(), { tools: { git: "1.0" } });
  } finally {
    delete process.env.CW_SCANNER_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the baseline has no tools property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, JSON.stringify({ foo: 1 }));
    process.env.CW_SCANNER_BASELINE = p;
    assert.throws(() => readBaseline(), { name: 'Error', message: 'baseline has no tools{}' });
  } finally {
    delete process.env.CW_SCANNER_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the baseline tools is a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, JSON.stringify({ tools: 'nope' }));
    process.env.CW_SCANNER_BASELINE = p;
    assert.throws(() => readBaseline(), { name: 'Error', message: 'baseline has no tools{}' });
  } finally {
    delete process.env.CW_SCANNER_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the baseline is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, 'null');
    process.env.CW_SCANNER_BASELINE = p;
    assert.throws(() => readBaseline(), { name: 'Error', message: 'baseline has no tools{}' });
  } finally {
    delete process.env.CW_SCANNER_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the baseline is invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, '{not json');
    process.env.CW_SCANNER_BASELINE = p;
    assert.throws(() => readBaseline(), { name: 'SyntaxError' });
  } finally {
    delete process.env.CW_SCANNER_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});
