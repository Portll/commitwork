// Per-language file counts and byte totals of a directory tree (monitor/surface-census.mjs walkSurface).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkSurface } from '../surface-census.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const put = (root, rel, n) => {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'x'.repeat(n));
  return file;
};

test('counts known-extension files case-insensitively and ignores unknown, extensionless and dot-leading names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'walkSurface-'));
  try {
    put(dir, 'a.js', 3);
    put(dir, 'B.JS', 4);
    put(dir, 'README', 5);
    put(dir, '.js', 6);
    put(dir, 'c.qqz', 7);
    const result = walkSurface(dir);
    assert.deepEqual(result, { javascript: { files: 2, bytes: 7 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty object when every file has an unrecognised name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'walkSurface-'));
  try {
    put(dir, 'c.qqz', 2);
    put(dir, 'README', 9);
    const result = walkSurface(dir);
    assert.deepEqual(result, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('descends into ordinary directories but not into skipped ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'walkSurface-'));
  try {
    put(dir, join('src', 'a.js'), 2);
    put(dir, join('node_modules', 'b.js'), 4);
    put(dir, join('.git', 'c.js'), 8);
    const result = walkSurface(dir);
    assert.deepEqual(result, { javascript: { files: 1, bytes: 2 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts files five directories deep but not six directories deep', () => {
  const dir = mkdtempSync(join(tmpdir(), 'walkSurface-'));
  try {
    put(dir, join('a', 'b', 'c', 'd', 'e', 'x.js'), 3);
    put(dir, join('a', 'b', 'c', 'd', 'e', 'f', 'y.js'), 5);
    const result = walkSurface(dir);
    assert.deepEqual(result, { javascript: { files: 1, bytes: 3 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores symlinks to files and to directories even with a known extension', () => {
  const dir = mkdtempSync(join(tmpdir(), 'walkSurface-'));
  try {
    const real = put(dir, 'real.js', 3);
    put(dir, join('src', 's.js'), 4);
    symlinkSync(real, join(dir, 'link.js'));
    symlinkSync(join(dir, 'src'), join(dir, 'lnsrc'));
    const result = walkSurface(dir);
    assert.deepEqual(result, { javascript: { files: 2, bytes: 7 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty object for a root that does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'walkSurface-'));
  try {
    const missing = join(dir, 'missing');
    const result = walkSurface(missing);
    assert.deepEqual(result, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty object when the root is a file rather than a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'walkSurface-'));
  try {
    const file = put(dir, 'solo.js', 6);
    const result = walkSurface(file);
    assert.deepEqual(result, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
