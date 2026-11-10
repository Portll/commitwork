// Reads the last n bytes of a file and reports truncation and metadata (admin/lib/session-view.mjs readTail).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTail } from '../lib/session-view.mjs';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns ok false with why absent when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTail-'));
  try {
    const res = readTail(join(dir, 'nope.txt'), 10);
    assert.deepEqual(res, { ok: false, why: 'absent' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the whole file when n is larger than the file size', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTail-'));
  try {
    const p = join(dir, 'small.txt');
    writeFileSync(p, 'hello');
    const res = readTail(p, 100);
    assert.equal(res.ok, true);
    assert.equal(res.text, 'hello');
    assert.equal(res.truncated, false);
    assert.equal(res.size, 5);
    assert.equal(typeof res.mtimeMs, 'number');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the last n bytes and marks truncated when n is smaller than the file size', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTail-'));
  try {
    const p = join(dir, 'big.txt');
    writeFileSync(p, 'abcdefghij');
    const res = readTail(p, 3);
    assert.equal(res.ok, true);
    assert.equal(res.text, 'hij');
    assert.equal(res.truncated, true);
    assert.equal(res.size, 10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the whole file and not truncated when n equals the file size', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTail-'));
  try {
    const p = join(dir, 'exact.txt');
    writeFileSync(p, 'abc');
    const res = readTail(p, 3);
    assert.equal(res.ok, true);
    assert.equal(res.text, 'abc');
    assert.equal(res.truncated, false);
    assert.equal(res.size, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty string and not truncated for an empty file with any positive n', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTail-'));
  try {
    const p = join(dir, 'empty.txt');
    writeFileSync(p, '');
    const res = readTail(p, 5);
    assert.equal(res.ok, true);
    assert.equal(res.text, '');
    assert.equal(res.truncated, false);
    assert.equal(res.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty string and truncated when n is zero on a non-empty file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTail-'));
  try {
    const p = join(dir, 'data.txt');
    writeFileSync(p, 'xyz');
    const res = readTail(p, 0);
    assert.equal(res.ok, true);
    assert.equal(res.text, '');
    assert.equal(res.truncated, true);
    assert.equal(res.size, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false with the error code when the path is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTail-'));
  try {
    const sub = join(dir, 'subdir');
    mkdirSync(sub);
    const res = readTail(sub, 10);
    assert.equal(res.ok, false);
    assert.equal(res.why, 'EISDIR');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the last n bytes of a large file built with repeated characters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTail-'));
  try {
    const p = join(dir, 'large.txt');
    const content = 'a'.repeat(1000) + 'b'.repeat(50);
    writeFileSync(p, content);
    const res = readTail(p, 50);
    assert.equal(res.ok, true);
    assert.equal(res.text, 'b'.repeat(50));
    assert.equal(res.truncated, true);
    assert.equal(res.size, 1050);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
