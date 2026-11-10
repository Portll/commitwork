// The SHA-256 hex digest of a file's bytes (monitor/scanner-binary.mjs sha256File).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256File } from '../scanner-binary.mjs';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const digestOf = (buf) => createHash('sha256').update(buf).digest('hex');
const pattern = (n) => Buffer.from(Array.from({ length: n }, (_, i) => i % 251));

test('an empty file hashes to the sha256 of no bytes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sha256File-'));
  try {
    const p = join(dir, 'empty.bin');
    writeFileSync(p, '');
    const result = await sha256File(p);
    assert.equal(result, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file containing hello world hashes to its known sha256 hex digest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sha256File-'));
  try {
    const p = join(dir, 'hello.txt');
    writeFileSync(p, 'hello world');
    const result = await sha256File(p);
    assert.equal(result, 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file containing abc hashes to its known sha256 hex digest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sha256File-'));
  try {
    const p = join(dir, 'abc.txt');
    writeFileSync(p, 'abc');
    const result = await sha256File(p);
    assert.equal(result, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file of exactly one default read chunk hashes all of its bytes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sha256File-'));
  try {
    const p = join(dir, 'chunk.bin');
    const buf = pattern(65536);
    writeFileSync(p, buf);
    const expected = digestOf(buf);
    const result = await sha256File(p);
    assert.equal(result, expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file one byte longer than a read chunk hashes the trailing byte too', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sha256File-'));
  try {
    const p = join(dir, 'chunk-plus-one.bin');
    const buf = pattern(65537);
    writeFileSync(p, buf);
    const expected = digestOf(buf);
    const result = await sha256File(p);
    assert.equal(result, expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file spanning several read chunks hashes every chunk in order', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sha256File-'));
  try {
    const p = join(dir, 'large.bin');
    const buf = pattern(200000);
    writeFileSync(p, buf);
    const expected = digestOf(buf);
    const result = await sha256File(p);
    assert.equal(result, expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file of null bytes hashes to the digest of those bytes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sha256File-'));
  try {
    const p = join(dir, 'nulls.bin');
    const buf = Buffer.alloc(1000, 0);
    writeFileSync(p, buf);
    const expected = digestOf(buf);
    const result = await sha256File(p);
    assert.equal(result, expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing file rejects with the ENOENT open error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sha256File-'));
  try {
    const p = join(dir, 'missing.bin');
    await assert.rejects(sha256File(p), {
      name: 'Error',
      code: 'ENOENT',
      syscall: 'open',
      message: `ENOENT: no such file or directory, open '${p}'`,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a directory path rejects with an EISDIR error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sha256File-'));
  try {
    const p = join(dir, 'sub');
    mkdirSync(p);
    await assert.rejects(sha256File(p), { name: 'Error', code: 'EISDIR' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
