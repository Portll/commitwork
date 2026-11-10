// Reads the first bytes of a file as a UTF-8 string (bin/lib/wordpress.mjs readHead).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHead } from '../lib/wordpress.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the full content when the file is shorter than the requested head size', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHead-'));
  try {
    const p = join(dir, 'short.txt');
    writeFileSync(p, 'hello');
    const r = readHead(p, 8192);
    assert.equal(r, "hello");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns only the first bytes when the file is longer than the requested head size', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHead-'));
  try {
    const p = join(dir, 'long.txt');
    writeFileSync(p, 'abcdefghij');
    const r = readHead(p, 5);
    assert.equal(r, "abcde");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty string when the file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHead-'));
  try {
    const p = join(dir, 'empty.txt');
    writeFileSync(p, '');
    const r = readHead(p, 8192);
    assert.equal(r, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the full content when the file length equals the requested head size', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHead-'));
  try {
    const p = join(dir, 'exact.txt');
    writeFileSync(p, '12345');
    const r = readHead(p, 5);
    assert.equal(r, "12345");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the first byte of a two-byte file when the requested head size is one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHead-'));
  try {
    const p = join(dir, 'two.txt');
    writeFileSync(p, 'ab');
    const r = readHead(p, 1);
    assert.equal(r, "a");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the first four bytes of a six-byte file when the requested head size is four', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHead-'));
  try {
    const p = join(dir, 'six.txt');
    writeFileSync(p, 'abcdef');
    const r = readHead(p, 4);
    assert.equal(r, "abcd");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
