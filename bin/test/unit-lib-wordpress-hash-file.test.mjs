// Computes MD5 and SHA-256 digests of a file (bin/lib/wordpress.mjs hashFile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashFile } from '../lib/wordpress.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

test('returns correct digests for a small file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hashFile-'));
  try {
    const p = join(dir, 'small.txt');
    writeFileSync(p, 'hello world');
    const r = hashFile(p);
    const md5 = createHash('md5').update('hello world').digest('hex');
    const sha256 = createHash('sha256').update('hello world').digest('hex');
    assert.deepEqual(r, { md5, sha256 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns correct digests for a file larger than one chunk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hashFile-'));
  try {
    const p = join(dir, 'big.bin');
    const data = Buffer.alloc(1024 * 1024 + 100, 0x42);
    writeFileSync(p, data);
    const r = hashFile(p);
    const md5 = createHash('md5').update(data).digest('hex');
    const sha256 = createHash('sha256').update(data).digest('hex');
    assert.deepEqual(r, { md5, sha256 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns correct digests for an empty file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hashFile-'));
  try {
    const p = join(dir, 'empty.txt');
    writeFileSync(p, '');
    const r = hashFile(p);
    const md5 = createHash('md5').update('').digest('hex');
    const sha256 = createHash('sha256').update('').digest('hex');
    assert.deepEqual(r, { md5, sha256 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns correct digests for a file exactly one chunk in size', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hashFile-'));
  try {
    const p = join(dir, 'exact.bin');
    const data = Buffer.alloc(1024 * 1024, 0x7f);
    writeFileSync(p, data);
    const r = hashFile(p);
    const md5 = createHash('md5').update(data).digest('hex');
    const sha256 = createHash('sha256').update(data).digest('hex');
    assert.deepEqual(r, { md5, sha256 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns correct digests for a file one byte over one chunk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hashFile-'));
  try {
    const p = join(dir, 'over.bin');
    const data = Buffer.alloc(1024 * 1024 + 1, 0x11);
    writeFileSync(p, data);
    const r = hashFile(p);
    const md5 = createHash('md5').update(data).digest('hex');
    const sha256 = createHash('sha256').update(data).digest('hex');
    assert.deepEqual(r, { md5, sha256 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
