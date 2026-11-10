// The last non-empty line of a file (bin/lib/touch-chain.mjs readTailLine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTailLine } from '../lib/touch-chain.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTailLine-'));
  try {
    assert.equal(readTailLine(join(dir, 'missing.txt')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rethrows open errors other than a missing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTailLine-'));
  try {
    const file = join(dir, 'plain.txt');
    writeFileSync(file, 'x\n');
    const p = join(file, 'child');
    assert.throws(() => readTailLine(p), { name: 'Error', code: 'ENOTDIR', message: `ENOTDIR: not a directory, open '${p}'` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for an empty file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTailLine-'));
  try {
    const p = join(dir, 'empty.txt');
    writeFileSync(p, '');
    assert.equal(readTailLine(p), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the only line of a single-line file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTailLine-'));
  try {
    const p = join(dir, 'one.txt');
    writeFileSync(p, 'hello\n');
    assert.equal(readTailLine(p), 'hello');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the last line when the file has no trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTailLine-'));
  try {
    const p = join(dir, 'notrail.txt');
    writeFileSync(p, 'first\nsecond');
    assert.equal(readTailLine(p), 'second');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips trailing blank lines to find the last non-empty line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTailLine-'));
  try {
    const p = join(dir, 'multi.txt');
    writeFileSync(p, 'a\nb\n\n\n');
    assert.equal(readTailLine(p), 'b');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('widens to the whole file when the window holds only part of the last line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTailLine-'));
  try {
    const p = join(dir, 'wide.txt');
    writeFileSync(p, 'one\nabcdefgh');
    assert.equal(readTailLine(p, 4), 'abcdefgh');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reads from the start when the size equals the window and widens when it is one byte over', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTailLine-'));
  try {
    const eq = join(dir, 'eq.txt');
    const over = join(dir, 'over.txt');
    writeFileSync(eq, 'abcdefgh');
    writeFileSync(over, 'abcdefghi');
    assert.equal(readTailLine(eq, 8), 'abcdefgh');
    assert.equal(readTailLine(over, 8), 'abcdefghi');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the window past the start holds only newlines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTailLine-'));
  try {
    const p = join(dir, 'newlines.txt');
    writeFileSync(p, 'a' + '\n'.repeat(4));
    assert.equal(readTailLine(p, 4), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses an 8192 byte default window and widens for a longer last line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTailLine-'));
  try {
    const fits = join(dir, 'fits.txt');
    const long = join(dir, 'long.txt');
    writeFileSync(fits, 'y'.repeat(8191) + '\n');
    writeFileSync(long, 'x'.repeat(8192) + '\n');
    assert.equal(readTailLine(fits), 'y'.repeat(8191));
    assert.equal(readTailLine(long), 'x'.repeat(8192));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
