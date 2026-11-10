// Loads and validates the advisory index JSON file (bin/advisory-index.mjs loadIndex).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadIndex } from '../advisory-index.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeDir() {
  return mkdtempSync(join(tmpdir(), 'loadIndex-'));
}

test('returns empty index object when file does not exist', () => {
  const dir = makeDir();
  try {
    const p = join(dir, 'missing.json');
    const result = loadIndex(p);
    assert.deepEqual(result, { source: 'github-advisory-database', generated: null, count: 0, advisories: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed JSON when file contains valid advisories map', () => {
  const dir = makeDir();
  try {
    const p = join(dir, 'index.json');
    const data = { source: 'test', generated: '2024-01-01', count: 1, advisories: { 'GHSA-1': { severity: 'high' } } };
    writeFileSync(p, JSON.stringify(data), 'utf8');
    const result = loadIndex(p);
    assert.deepEqual(result, data);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws error when JSON has no advisories property', () => {
  const dir = makeDir();
  try {
    const p = join(dir, 'index.json');
    writeFileSync(p, JSON.stringify({ source: 'test', count: 0 }), 'utf8');
    assert.throws(() => loadIndex(p), /has no advisories map/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws error when advisories is null', () => {
  const dir = makeDir();
  try {
    const p = join(dir, 'index.json');
    writeFileSync(p, JSON.stringify({ source: 'test', advisories: null }), 'utf8');
    assert.throws(() => loadIndex(p), /has no advisories map/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws error when advisories is a string', () => {
  const dir = makeDir();
  try {
    const p = join(dir, 'index.json');
    writeFileSync(p, JSON.stringify({ source: 'test', advisories: 'not-an-object' }), 'utf8');
    assert.throws(() => loadIndex(p), /has no advisories map/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed JSON when advisories is an array', () => {
  const dir = makeDir();
  try {
    const p = join(dir, 'index.json');
    const data = { source: 'test', generated: null, count: 3, advisories: [1, 2, 3] };
    writeFileSync(p, JSON.stringify(data), 'utf8');
    const result = loadIndex(p);
    assert.deepEqual(result, data);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws error when JSON is corrupt', () => {
  const dir = makeDir();
  try {
    const p = join(dir, 'index.json');
    writeFileSync(p, '{invalid json', 'utf8');
    assert.throws(() => loadIndex(p), SyntaxError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed JSON when advisories is an empty object', () => {
  const dir = makeDir();
  try {
    const p = join(dir, 'index.json');
    const data = { source: 'test', generated: null, count: 0, advisories: {} };
    writeFileSync(p, JSON.stringify(data), 'utf8');
    const result = loadIndex(p);
    assert.deepEqual(result, data);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws error when JSON parses to null', () => {
  const dir = makeDir();
  try {
    const p = join(dir, 'index.json');
    writeFileSync(p, 'null', 'utf8');
    assert.throws(() => loadIndex(p), /has no advisories map/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
