// Writes text to a file atomically, creating any missing parent directories (cra/lib.mjs writeTextAtomic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeTextAtomic } from '../lib.mjs';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('creates nested parent directories and writes the exact text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeTextAtomic-'));
  try {
    const p = join(dir, 'a', 'b', 'c', 'file.txt');
    writeTextAtomic(p, 'hello');
    assert.equal(readFileSync(p, 'utf8'), 'hello');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes an empty string to a file whose directory already exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeTextAtomic-'));
  try {
    const p = join(dir, 'empty.txt');
    writeTextAtomic(p, '');
    assert.equal(readFileSync(p, 'utf8'), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('overwrites an existing file with the new content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeTextAtomic-'));
  try {
    const p = join(dir, 'overwrite.txt');
    writeFileSync(p, 'old');
    writeTextAtomic(p, 'new');
    assert.equal(readFileSync(p, 'utf8'), 'new');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes multi-line text with tabs and carriage returns unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeTextAtomic-'));
  try {
    const p = join(dir, 'special.txt');
    writeTextAtomic(p, 'line1\nline2\ttabbed\r\nend');
    assert.equal(readFileSync(p, 'utf8'), 'line1\nline2\ttabbed\r\nend');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes large repeated content in full', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeTextAtomic-'));
  try {
    const p = join(dir, 'large.txt');
    writeTextAtomic(p, 'x'.repeat(10000));
    assert.equal(readFileSync(p, 'utf8'), 'x'.repeat(10000));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates a single missing parent directory and writes the content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeTextAtomic-'));
  try {
    const p = join(dir, 'newdir', 'file.txt');
    writeTextAtomic(p, 'data');
    assert.equal(readFileSync(p, 'utf8'), 'data');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes non-ASCII unicode content unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeTextAtomic-'));
  try {
    const p = join(dir, 'unicode.txt');
    writeTextAtomic(p, 'caf\u00e9 \u00fcber \u00f8r\u00e9');
    assert.equal(readFileSync(p, 'utf8'), 'caf\u00e9 \u00fcber \u00f8r\u00e9');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes into a pre-existing nested directory without failing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeTextAtomic-'));
  try {
    mkdirSync(join(dir, 'l1', 'l2'), { recursive: true });
    const p = join(dir, 'l1', 'l2', 'deep.txt');
    writeTextAtomic(p, 'deep');
    assert.equal(readFileSync(p, 'utf8'), 'deep');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
