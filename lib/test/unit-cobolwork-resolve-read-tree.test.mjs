// Reads all regular files under <dir>/package recursively (lib/cobolwork-resolve.mjs readTree).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTree } from '../cobolwork-resolve.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an empty array when the package directory is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTree-'));
  try {
    mkdirSync(join(dir, 'package'));
    const result = readTree(dir);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a single entry for a single file in package', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTree-'));
  try {
    mkdirSync(join(dir, 'package'));
    writeFileSync(join(dir, 'package', 'a.txt'), 'hello');
    const result = readTree(dir);
    assert.deepEqual(result, [{ path: 'package/a.txt', data: Buffer.from('hello') }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns entries for multiple files in package', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTree-'));
  try {
    mkdirSync(join(dir, 'package'));
    writeFileSync(join(dir, 'package', 'a.txt'), 'aaa');
    writeFileSync(join(dir, 'package', 'b.txt'), 'bbb');
    const result = readTree(dir);
    assert.equal(result.length, 2);
    assert.deepEqual(result[0], { path: 'package/a.txt', data: Buffer.from('aaa') });
    assert.deepEqual(result[1], { path: 'package/b.txt', data: Buffer.from('bbb') });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recurses into subdirectories under package', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTree-'));
  try {
    mkdirSync(join(dir, 'package'), { recursive: true });
    mkdirSync(join(dir, 'package', 'sub'), { recursive: true });
    writeFileSync(join(dir, 'package', 'sub', 'c.txt'), 'ccc');
    const result = readTree(dir);
    assert.deepEqual(result, [{ path: 'package/sub/c.txt', data: Buffer.from('ccc') }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recurses into nested subdirectories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTree-'));
  try {
    mkdirSync(join(dir, 'package'), { recursive: true });
    mkdirSync(join(dir, 'package', 'x', 'y'), { recursive: true });
    writeFileSync(join(dir, 'package', 'x', 'y', 'd.txt'), 'ddd');
    const result = readTree(dir);
    assert.deepEqual(result, [{ path: 'package/x/y/d.txt', data: Buffer.from('ddd') }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes both files and subdirectory contents in order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTree-'));
  try {
    mkdirSync(join(dir, 'package'), { recursive: true });
    mkdirSync(join(dir, 'package', 'sub'), { recursive: true });
    writeFileSync(join(dir, 'package', 'a.txt'), 'aaa');
    writeFileSync(join(dir, 'package', 'sub', 'b.txt'), 'bbb');
    const result = readTree(dir);
    assert.equal(result.length, 2);
    assert.deepEqual(result[0], { path: 'package/a.txt', data: Buffer.from('aaa') });
    assert.deepEqual(result[1], { path: 'package/sub/b.txt', data: Buffer.from('bbb') });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when a symlink exists in package', { skip: process.platform === 'win32' && 'symlinks need a privilege on Windows' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTree-'));
  try {
    mkdirSync(join(dir, 'package'));
    writeFileSync(join(dir, 'package', 'target.txt'), 'target');
    symlinkSync(join(dir, 'package', 'target.txt'), join(dir, 'package', 'link.txt'));
    assert.throws(() => readTree(dir), /is neither a file nor a directory/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when a symlink exists in a subdirectory of package', { skip: process.platform === 'win32' && 'symlinks need a privilege on Windows' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTree-'));
  try {
    mkdirSync(join(dir, 'package'), { recursive: true });
    mkdirSync(join(dir, 'package', 'sub'), { recursive: true });
    writeFileSync(join(dir, 'package', 'sub', 'target.txt'), 'target');
    symlinkSync(join(dir, 'package', 'sub', 'target.txt'), join(dir, 'package', 'sub', 'link.txt'));
    assert.throws(() => readTree(dir), /is neither a file nor a directory/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
