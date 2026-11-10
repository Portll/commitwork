// whether a path is an existing regular file (monitor/history-chain.mjs fileExists).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileExists } from '../history-chain.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns true for an existing regular file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fileExists-'));
  try {
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'x');
    assert.equal(fileExists(f), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false for a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fileExists-'));
  try {
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    assert.equal(fileExists(sub), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false for a missing path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fileExists-'));
  try {
    const missing = join(dir, 'nope.txt');
    assert.equal(fileExists(missing), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false for a path whose parent does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fileExists-'));
  try {
    const deep = join(dir, 'no-such-dir', 'file.txt');
    assert.equal(fileExists(deep), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false for an empty string path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fileExists-'));
  try {
    assert.equal(fileExists(''), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false for a path with a very long name that does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fileExists-'));
  try {
    const long = join(dir, 'x'.repeat(200) + '.txt');
    assert.equal(fileExists(long), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
