// Computes a base64url digest and byte size of a file (bin/tree-integrity.mjs hashFile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashFile } from '../tree-integrity.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

test('returns correct digest and size for an empty file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hashFile-'));
  try {
    const f = join(dir, 'empty.txt');
    writeFileSync(f, '');
    const r = hashFile(f, 'sha256');
    assert.deepEqual(r, { digest: "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU", size: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns correct digest and size for a single byte file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hashFile-'));
  try {
    const f = join(dir, 'one.txt');
    writeFileSync(f, 'a');
    const r = hashFile(f, 'sha256');
    assert.deepEqual(r, { digest: "ypeBEsobvcr6wjGzmiPcTaeG7_gUfE5yuYB3ha_uSLs", size: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns correct digest and size for a file with multiple chunks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hashFile-'));
  try {
    const f = join(dir, 'big.bin');
    const data = Buffer.alloc(2 * 1024 * 1024 + 123, 0x42);
    writeFileSync(f, data);
    const r = hashFile(f, 'sha256');
    assert.deepEqual(r, { digest: "GV_mNfCaTKrd4UXpWPkxLjYxt3rGzfyBK9KGMFAgC0A", size: 2097275 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns correct digest and size for a file exactly one chunk in size', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hashFile-'));
  try {
    const f = join(dir, 'chunk.bin');
    const data = Buffer.alloc(1024 * 1024, 0x00);
    writeFileSync(f, data);
    const r = hashFile(f, 'sha256');
    assert.deepEqual(r, { digest: "MOFJVevxNSJm3C_4Bn5oEEYH51CrudOzZYK4r5Cfy1g", size: 1048576 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns correct digest and size for a file one byte less than one chunk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hashFile-'));
  try {
    const f = join(dir, 'almost.bin');
    const data = Buffer.alloc(1024 * 1024 - 1, 0xff);
    writeFileSync(f, data);
    const r = hashFile(f, 'sha256');
    assert.deepEqual(r, { digest: "o60QO2DOO__RZ-jnEXH9Mj6BairjgqiJDTiyvMZ8XAY", size: 1048575 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns correct digest and size for a file one byte more than one chunk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hashFile-'));
  try {
    const f = join(dir, 'over.bin');
    const data = Buffer.alloc(1024 * 1024 + 1, 0xab);
    writeFileSync(f, data);
    const r = hashFile(f, 'sha256');
    assert.deepEqual(r, { digest: "XR_Zp37QEWsoLIH4O6SDjGtSfBgGkRE9r5zjdWvQRsI", size: 1048577 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns correct digest and size for a file with non-ascii content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hashFile-'));
  try {
    const f = join(dir, 'utf8.txt');
    const data = Buffer.from('h\u00e9llo w\u00f6rld', 'utf8');
    writeFileSync(f, data);
    const r = hashFile(f, 'sha256');
    assert.deepEqual(r, { digest: "oQA_fQSkEVcR0LSKLq8TWc5WXS0qb9ZQmN_P-t7u9Z8", size: 13 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns correct digest and size for a file with repeated pattern', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hashFile-'));
  try {
    const f = join(dir, 'pattern.bin');
    const data = Buffer.from('x'.repeat(5000));
    writeFileSync(f, data);
    const r = hashFile(f, 'sha256');
    assert.deepEqual(r, { digest: "xZ08BIDMLXHY9kbnNektplRQMR7sRugaXbjH5uipIFQ", size: 5000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
