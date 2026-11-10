// reads a file or returns null / throws on error (bin/exit-codes.mjs read).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read } from '../exit-codes.mjs';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns file contents when file exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'read-'));
  try {
    const rel = 'file.txt';
    const content = 'hello world';
    writeFileSync(join(dir, rel), content, 'utf8');
    const result = read(dir, rel);
    assert.equal(result, content);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'read-'));
  try {
    const rel = 'missing.txt';
    const result = read(dir, rel);
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws with exitCode UNREADABLE when path is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'read-'));
  try {
    const rel = 'subdir';
    mkdirSync(join(dir, rel));
    assert.throws(() => read(dir, rel), (err) => {
      assert.equal(err.exitCode, 21);
      assert.match(err.message, /cannot read subdir/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty string for empty file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'read-'));
  try {
    const rel = 'empty.txt';
    writeFileSync(join(dir, rel), '', 'utf8');
    const result = read(dir, rel);
    assert.equal(result, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns multi-line content correctly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'read-'));
  try {
    const rel = 'multi.txt';
    const content = 'line1\nline2\nline3';
    writeFileSync(join(dir, rel), content, 'utf8');
    const result = read(dir, rel);
    assert.equal(result, content);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for nested missing path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'read-'));
  try {
    const rel = 'deep/nested/missing.txt';
    const result = read(dir, rel);
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws with exitCode UNREADABLE when path is a directory in nested location', () => {
  const dir = mkdtempSync(join(tmpdir(), 'read-'));
  try {
    const rel = 'a/b';
    mkdirSync(join(dir, rel), { recursive: true });
    assert.throws(() => read(dir, rel), (err) => {
      assert.equal(err.exitCode, 21);
      assert.match(err.message, /cannot read a\/b/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns content for file with special characters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'read-'));
  try {
    const rel = 'special.txt';
    const content = 'tab\there\nnewline\nquote"end';
    writeFileSync(join(dir, rel), content, 'utf8');
    const result = read(dir, rel);
    assert.equal(result, content);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
