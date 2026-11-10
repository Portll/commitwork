// The path of the newest sweep- batch directory under root, or null (monitor/sandbox-coverage.mjs latestSweep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestSweep } from '../sandbox-coverage.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the root directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'latestSweep-'));
  try {
    const input = join(dir, 'nope');
    const result = latestSweep(input);
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rethrows the error when the root is a file rather than a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'latestSweep-'));
  try {
    const file = join(dir, 'plain.txt');
    writeFileSync(file, 'x');
    assert.throws(() => latestSweep(file), { name: 'Error', code: 'ENOTDIR', syscall: 'scandir' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the root is an empty directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'latestSweep-'));
  try {
    const result = latestSweep(dir);
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when only non-sweep directories and sweep- files exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'latestSweep-'));
  try {
    mkdirSync(join(dir, 'other'));
    mkdirSync(join(dir, 'Sweep-20240105'));
    writeFileSync(join(dir, 'sweep-notdir'), 'x');
    const result = latestSweep(dir);
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the only sweep- directory when exactly one exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'latestSweep-'));
  try {
    mkdirSync(join(dir, 'sweep-20240101'));
    const result = latestSweep(dir);
    assert.equal(result, join(dir, 'sweep-20240101'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the last sorted sweep- directory when three exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'latestSweep-'));
  try {
    mkdirSync(join(dir, 'sweep-20240102'));
    mkdirSync(join(dir, 'sweep-20240103'));
    mkdirSync(join(dir, 'sweep-20240101'));
    const result = latestSweep(dir);
    assert.equal(result, join(dir, 'sweep-20240103'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips a newer sweep- file and returns the older sweep- directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'latestSweep-'));
  try {
    writeFileSync(join(dir, 'sweep-20240102'), 'x');
    mkdirSync(join(dir, 'sweep-20240101'));
    const result = latestSweep(dir);
    assert.equal(result, join(dir, 'sweep-20240101'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips a newer sweep- entry whose stat fails because it is a broken symlink', () => {
  const dir = mkdtempSync(join(tmpdir(), 'latestSweep-'));
  try {
    mkdirSync(join(dir, 'sweep-20240101'));
    symlinkSync(join(dir, 'missing-target'), join(dir, 'sweep-20240109'));
    const result = latestSweep(dir);
    assert.equal(result, join(dir, 'sweep-20240101'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('orders sweep- directories by string comparison, not numeric value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'latestSweep-'));
  try {
    mkdirSync(join(dir, 'sweep-10'));
    mkdirSync(join(dir, 'sweep-9'));
    mkdirSync(join(dir, 'sweep-100'));
    const result = latestSweep(dir);
    assert.equal(result, join(dir, 'sweep-9'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
