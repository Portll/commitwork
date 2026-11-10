// Set of batch identifiers recorded in the append-only coverage ledger (monitor/archive-batches.mjs coveredBatches).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coveredBatches } from '../archive-batches.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('returns an empty set when the coverage file does not exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coveredBatches-'));
  try {
    process.env.CW_ARCHIVE_DIR = dir;
    const r = coveredBatches();
    assert.deepEqual(r, new Set([]));
  } finally {
    delete process.env.CW_ARCHIVE_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty set when the coverage file is empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coveredBatches-'));
  try {
    process.env.CW_ARCHIVE_DIR = dir;
    fs.writeFileSync(path.join(dir, 'coverage.jsonl'), '');
    const r = coveredBatches();
    assert.deepEqual(r, new Set([]));
  } finally {
    delete process.env.CW_ARCHIVE_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collects batch identifiers from valid jsonl lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coveredBatches-'));
  try {
    process.env.CW_ARCHIVE_DIR = dir;
    const lines = [
      JSON.stringify({ batches: ['alpha', 'beta'] }),
      JSON.stringify({ batches: ['gamma'] }),
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'coverage.jsonl'), lines);
    const r = coveredBatches();
    assert.deepEqual(r, new Set(["alpha", "beta", "gamma"]));
  } finally {
    delete process.env.CW_ARCHIVE_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores malformed json lines without throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coveredBatches-'));
  try {
    process.env.CW_ARCHIVE_DIR = dir;
    const lines = [
      JSON.stringify({ batches: ['good'] }),
      'not valid json {{{',
      JSON.stringify({ batches: ['also-good'] }),
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'coverage.jsonl'), lines);
    const r = coveredBatches();
    assert.deepEqual(r, new Set(["good", "also-good"]));
  } finally {
    delete process.env.CW_ARCHIVE_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores lines whose parsed object has no batches property', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coveredBatches-'));
  try {
    process.env.CW_ARCHIVE_DIR = dir;
    const lines = [
      JSON.stringify({ other: 'field' }),
      JSON.stringify({ batches: ['present'] }),
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'coverage.jsonl'), lines);
    const r = coveredBatches();
    assert.deepEqual(r, new Set(["present"]));
  } finally {
    delete process.env.CW_ARCHIVE_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skips blank lines between valid entries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coveredBatches-'));
  try {
    process.env.CW_ARCHIVE_DIR = dir;
    const lines = [
      JSON.stringify({ batches: ['x'] }),
      '',
      '',
      JSON.stringify({ batches: ['y'] }),
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'coverage.jsonl'), lines);
    const r = coveredBatches();
    assert.deepEqual(r, new Set(["x", "y"]));
  } finally {
    delete process.env.CW_ARCHIVE_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deduplicates batch identifiers appearing in multiple lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coveredBatches-'));
  try {
    process.env.CW_ARCHIVE_DIR = dir;
    const lines = [
      JSON.stringify({ batches: ['dup', 'unique1'] }),
      JSON.stringify({ batches: ['dup', 'unique2'] }),
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'coverage.jsonl'), lines);
    const r = coveredBatches();
    assert.deepEqual(r, new Set(["dup", "unique1", "unique2"]));
  } finally {
    delete process.env.CW_ARCHIVE_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the coverage path exists but is a directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coveredBatches-'));
  try {
    process.env.CW_ARCHIVE_DIR = dir;
    fs.mkdirSync(path.join(dir, 'coverage.jsonl'));
    assert.throws(() => coveredBatches(), '__expected__');
  } finally {
    delete process.env.CW_ARCHIVE_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
