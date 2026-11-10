// Reads a vendored file from disk, returning its buffer or a structured error (bin/vendor-verify.mjs readLocal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLocal } from '../vendor-verify.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns ok true and the file buffer when the file exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLocal-'));
  try {
    const rel = 'data.txt';
    const content = Buffer.from('hello world');
    writeFileSync(join(dir, rel), content);
    const result = readLocal(dir, rel);
    assert.deepEqual(result, { ok: true, buf: content });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false with absent message when file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLocal-'));
  try {
    const rel = 'missing.txt';
    const result = readLocal(dir, rel);
    assert.deepEqual(result, { ok: false, why: 'vendored file is absent \u2014 the roster claims an asset this tree does not have' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false with unreadable message when read fails with EACCES', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLocal-'));
  try {
    const rel = 'secret.txt';
    writeFileSync(join(dir, rel), Buffer.from('top secret'));
    const result = readLocal(dir, rel);
    const dirRel = 'subdir';
    mkdirSync(join(dir, dirRel));
    const result2 = readLocal(dir, dirRel);
    assert.equal(result2.ok, false);
    assert.match(result2.why, /vendored file unreadable:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false with unreadable message when path is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLocal-'));
  try {
    const rel = 'somedir';
    mkdirSync(join(dir, rel));
    const result = readLocal(dir, rel);
    assert.equal(result.ok, false);
    assert.match(result.why, /vendored file unreadable:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles empty file correctly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLocal-'));
  try {
    const rel = 'empty.txt';
    writeFileSync(join(dir, rel), Buffer.alloc(0));
    const result = readLocal(dir, rel);
    assert.deepEqual(result, { ok: true, buf: Buffer.alloc(0) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles binary content correctly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLocal-'));
  try {
    const rel = 'binary.bin';
    const content = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
    writeFileSync(join(dir, rel), content);
    const result = readLocal(dir, rel);
    assert.equal(result.ok, true);
    assert.deepEqual(result.buf, content);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles nested relative path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLocal-'));
  try {
    const rel = join('sub', 'deep', 'file.txt');
    mkdirSync(join(dir, 'sub', 'deep'), { recursive: true });
    const content = Buffer.from('nested content');
    writeFileSync(join(dir, rel), content);
    const result = readLocal(dir, rel);
    assert.deepEqual(result, { ok: true, buf: content });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false when nested path component is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLocal-'));
  try {
    const rel = join('nonexistent', 'file.txt');
    const result = readLocal(dir, rel);
    assert.deepEqual(result, { ok: false, why: 'vendored file is absent \u2014 the roster claims an asset this tree does not have' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
