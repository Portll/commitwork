// Lists sorted codeql-remediation paths for each subdirectory of a reports root (bin/divergence-review.mjs jobDirs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobDirs } from '../divergence-review.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('A missing root directory yields an empty list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobDirs-'));
  try {
    const missing = join(dir, 'no-such-root');
    assert.deepEqual(jobDirs(missing), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A root that is a file rethrows the ENOTDIR error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobDirs-'));
  try {
    const file = join(dir, 'root.txt');
    writeFileSync(file, 'data');
    assert.throws(() => jobDirs(file), {
      name: 'Error',
      code: 'ENOTDIR',
      message: `ENOTDIR: not a directory, scandir '${file}'`,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('An empty root directory yields an empty list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobDirs-'));
  try {
    const root = join(dir, 'root');
    mkdirSync(root);
    assert.deepEqual(jobDirs(root), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A root holding only files yields an empty list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobDirs-'));
  try {
    const root = join(dir, 'root');
    mkdirSync(root);
    writeFileSync(join(root, 'a.txt'), 'a');
    writeFileSync(join(root, 'b.txt'), 'b');
    assert.deepEqual(jobDirs(root), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A single subdirectory yields its codeql-remediation path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobDirs-'));
  try {
    const root = join(dir, 'root');
    mkdirSync(join(root, 'only'), { recursive: true });
    assert.deepEqual(jobDirs(root), [join(root, 'only', 'codeql-remediation')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Subdirectories are listed in sorted order and files are skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobDirs-'));
  try {
    const root = join(dir, 'root');
    mkdirSync(join(root, 'zeta'), { recursive: true });
    mkdirSync(join(root, 'alpha'));
    mkdirSync(join(root, 'mid'));
    writeFileSync(join(root, 'notadir.txt'), 'x');
    assert.deepEqual(jobDirs(root), [
      join(root, 'alpha', 'codeql-remediation'),
      join(root, 'mid', 'codeql-remediation'),
      join(root, 'zeta', 'codeql-remediation'),
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Sorting compares full joined paths by code unit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobDirs-'));
  try {
    const root = join(dir, 'root');
    mkdirSync(join(root, 'a'), { recursive: true });
    mkdirSync(join(root, 'a-b'));
    mkdirSync(join(root, 'Beta'));
    assert.deepEqual(jobDirs(root), [
      join(root, 'Beta', 'codeql-remediation'),
      join(root, 'a-b', 'codeql-remediation'),
      join(root, 'a', 'codeql-remediation'),
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A symlink to a directory is not counted as a subdirectory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobDirs-'));
  try {
    const root = join(dir, 'root');
    mkdirSync(join(root, 'real'), { recursive: true });
    symlinkSync(join(root, 'real'), join(root, 'link'));
    assert.deepEqual(jobDirs(root), [join(root, 'real', 'codeql-remediation')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
