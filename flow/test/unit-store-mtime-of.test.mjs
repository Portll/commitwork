// ISO string of a path's mtime, null when missing (flow/store.mjs mtimeOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mtimeOf } from '../store.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the mtime of an existing file as an ISO string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mtimeOf-'));
  try {
    const p = join(dir, 'a.txt');
    writeFileSync(p, 'x');
    utimesSync(p, 1577934245, 1577934245);
    assert.equal(mtimeOf(p), '2020-01-02T03:04:05.000Z');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the epoch ISO string for a file whose mtime is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mtimeOf-'));
  try {
    const p = join(dir, 'zero.txt');
    writeFileSync(p, 'y');
    utimesSync(p, 0, 0);
    assert.equal(mtimeOf(p), '1970-01-01T00:00:00.000Z');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the mtime of an existing directory as an ISO string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mtimeOf-'));
  try {
    const sub = join(dir, 'subdir');
    mkdirSync(sub);
    utimesSync(sub, 1000000000, 1000000000);
    assert.equal(mtimeOf(sub), '2001-09-09T01:46:40.000Z');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the path does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mtimeOf-'));
  try {
    const p = join(dir, 'missing.txt');
    assert.equal(mtimeOf(p), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for a path under a parent directory that does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mtimeOf-'));
  try {
    const p = join(dir, 'gone', 'file.txt');
    assert.equal(mtimeOf(p), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws CW_FLOW_STAT_FAILED naming ENOTDIR when the path goes through a regular file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mtimeOf-'));
  try {
    const f = join(dir, 'plain.txt');
    writeFileSync(f, 'data');
    const p = join(f, 'child');
    assert.throws(() => mtimeOf(p), {
      name: 'Error',
      message: `flow cannot stat ${p}: ENOTDIR`,
      code: 'CW_FLOW_STAT_FAILED',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws CW_FLOW_STAT_FAILED naming ENAMETOOLONG for a file name longer than 255 bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mtimeOf-'));
  try {
    const p = join(dir, 'x'.repeat(300));
    assert.throws(() => mtimeOf(p), {
      name: 'Error',
      message: `flow cannot stat ${p}: ENAMETOOLONG`,
      code: 'CW_FLOW_STAT_FAILED',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
