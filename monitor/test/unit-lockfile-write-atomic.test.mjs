// Crash-safe atomic file write via sibling temp file and rename (monitor/lockfile.mjs writeAtomic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeAtomic } from '../lockfile.mjs';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('writes data to the target path when mkdir is false and directory exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeAtomic-'));
  try {
    const target = join(dir, 'file.txt');
    writeAtomic(target, 'hello world');
    assert.equal(readFileSync(target, 'utf8'), 'hello world');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates parent directories when mkdir is true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeAtomic-'));
  try {
    const target = join(dir, 'a', 'b', 'c', 'file.txt');
    writeAtomic(target, 'nested data', { mkdir: true });
    assert.equal(readFileSync(target, 'utf8'), 'nested data');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('overwrites existing file content atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeAtomic-'));
  try {
    const target = join(dir, 'file.txt');
    writeFileSync(target, 'old content');
    writeAtomic(target, 'new content');
    assert.equal(readFileSync(target, 'utf8'), 'new content');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes empty string data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeAtomic-'));
  try {
    const target = join(dir, 'empty.txt');
    writeAtomic(target, '');
    assert.equal(readFileSync(target, 'utf8'), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes binary data correctly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeAtomic-'));
  try {
    const target = join(dir, 'binary.bin');
    const data = Buffer.from([0, 1, 2, 255, 254, 253]);
    writeAtomic(target, data);
    assert.deepEqual(readFileSync(target), data);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when target directory does not exist and mkdir is false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeAtomic-'));
  try {
    const target = join(dir, 'nonexistent', 'file.txt');
    assert.throws(() => {
      writeAtomic(target, 'data');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('leaves no temp file after successful write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeAtomic-'));
  try {
    const target = join(dir, 'file.txt');
    writeAtomic(target, 'data');
    const tmp = join(dir, `.${'file.txt'}.tmp-${process.pid}`);
    assert.equal(existsSync(tmp), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates single-level parent directory when mkdir is true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeAtomic-'));
  try {
    const target = join(dir, 'sub', 'file.txt');
    writeAtomic(target, 'single level', { mkdir: true });
    assert.equal(readFileSync(target, 'utf8'), 'single level');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
