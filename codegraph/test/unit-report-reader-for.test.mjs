// Returns a file reader bound to a root directory or a HEAD blob map (codegraph/report.mjs readerFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readerFor } from '../report.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('reads a file from the root directory when head is false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readerFor-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'alpha');
    const r = readerFor(dir, { head: false });
    assert.equal(r('a.txt'), "alpha");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reads a file from the root directory when the options object is omitted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readerFor-'));
  try {
    writeFileSync(join(dir, 'b.txt'), 'beta');
    const r = readerFor(dir);
    assert.equal(r('b.txt'), "beta");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the blob content for a path present in the map when head is true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readerFor-'));
  try {
    const blobs = new Map([['c.txt', 'gamma']]);
    const r = readerFor(dir, { head: true, blobs });
    assert.equal(r('c.txt'), "gamma");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an ENOENT error when the path is absent from the blob map', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readerFor-'));
  try {
    const blobs = new Map([['d.txt', 'delta']]);
    const r = readerFor(dir, { head: true, blobs });
    assert.throws(() => r('missing.txt'), { name: 'Error', message: 'no HEAD blob for missing.txt' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an ENOENT error when blobs is null and head is true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readerFor-'));
  try {
    const r = readerFor(dir, { head: true, blobs: null });
    assert.throws(() => r('e.txt'), { name: 'Error', message: 'no HEAD blob for e.txt' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the blob content when the map is empty and the path is not in it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readerFor-'));
  try {
    const blobs = new Map();
    const r = readerFor(dir, { head: true, blobs });
    assert.throws(() => r('f.txt'), { name: 'Error', message: 'no HEAD blob for f.txt' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
