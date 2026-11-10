// Lists the numbered archive generations of a file, sorted by number (bin/lib/ledger-rotate.mjs archiveGenerations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveGenerations } from '../lib/ledger-rotate.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an empty array when the directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archiveGenerations-'));
  try {
    const r = archiveGenerations(join(dir, 'missing', 'ledger.json'));
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rethrows a readdir error that is not ENOENT', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archiveGenerations-'));
  try {
    const notDir = join(dir, 'afile');
    writeFileSync(notDir, 'x');
    assert.throws(() => archiveGenerations(join(notDir, 'ledger.json')), {
      name: 'Error',
      code: 'ENOTDIR',
      message: `ENOTDIR: not a directory, scandir '${notDir}'`,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty array when the directory exists but is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archiveGenerations-'));
  try {
    assert.deepEqual(archiveGenerations(join(dir, 'ledger.json')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty array when only the live file and unrelated files exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archiveGenerations-'));
  try {
    writeFileSync(join(dir, 'ledger.json'), 'x');
    writeFileSync(join(dir, 'other.txt'), 'x');
    assert.deepEqual(archiveGenerations(join(dir, 'ledger.json')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns matching generations sorted numerically rather than by name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archiveGenerations-'));
  try {
    writeFileSync(join(dir, 'ledger.json.2'), 'x');
    writeFileSync(join(dir, 'ledger.json.10'), 'x');
    writeFileSync(join(dir, 'ledger.json.1'), 'x');
    assert.deepEqual(archiveGenerations(join(dir, 'ledger.json')), [
      { n: 1, path: join(dir, 'ledger.json.1') },
      { n: 2, path: join(dir, 'ledger.json.2') },
      { n: 10, path: join(dir, 'ledger.json.10') },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('orders generations nine, ten and eleven by their numbers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archiveGenerations-'));
  try {
    writeFileSync(join(dir, 'ledger.json.11'), 'x');
    writeFileSync(join(dir, 'ledger.json.9'), 'x');
    writeFileSync(join(dir, 'ledger.json.10'), 'x');
    assert.deepEqual(archiveGenerations(join(dir, 'ledger.json')), [
      { n: 9, path: join(dir, 'ledger.json.9') },
      { n: 10, path: join(dir, 'ledger.json.10') },
      { n: 11, path: join(dir, 'ledger.json.11') },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes names with the prefix whose suffix is not all digits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archiveGenerations-'));
  try {
    writeFileSync(join(dir, 'ledger.json.abc'), 'x');
    writeFileSync(join(dir, 'ledger.json.1a'), 'x');
    writeFileSync(join(dir, 'ledger.json.1'), 'x');
    assert.deepEqual(archiveGenerations(join(dir, 'ledger.json')), [
      { n: 1, path: join(dir, 'ledger.json.1') },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes names without the prefix even when their tail is digits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archiveGenerations-'));
  try {
    writeFileSync(join(dir, 'other.json.1'), 'x');
    writeFileSync(join(dir, `${'x'.repeat(12)}7`), 'x');
    writeFileSync(join(dir, 'edger.json.4'), 'x');
    writeFileSync(join(dir, 'ledger.json.1'), 'x');
    assert.deepEqual(archiveGenerations(join(dir, 'ledger.json')), [
      { n: 1, path: join(dir, 'ledger.json.1') },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('keeps suffixes with leading zeros and parses them as numbers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archiveGenerations-'));
  try {
    writeFileSync(join(dir, 'ledger.json.007'), 'x');
    writeFileSync(join(dir, 'ledger.json.3'), 'x');
    assert.deepEqual(archiveGenerations(join(dir, 'ledger.json')), [
      { n: 3, path: join(dir, 'ledger.json.3') },
      { n: 7, path: join(dir, 'ledger.json.007') },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
