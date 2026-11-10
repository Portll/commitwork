// Paths of egress-observed.json files under a root, plus walk failures (monitor/egress-suggest.mjs findObserved).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findObserved } from '../egress-suggest.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const NAME = 'egress-observed.json';
const put = (p) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, '{}'); };

test('an empty root directory yields no files and no failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findObserved-'));
  try {
    assert.deepEqual(findObserved(dir), { files: [], failures: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing root directory is not reported as a failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findObserved-'));
  try {
    assert.deepEqual(findObserved(join(dir, 'no-such-dir')), { files: [], failures: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a root that is a regular file is reported as an ENOTDIR failure at path dot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findObserved-'));
  try {
    const file = join(dir, 'plain.txt');
    put(file);
    assert.deepEqual(findObserved(file), { files: [], failures: [{ path: '.', why: 'ENOTDIR' }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unreadable subdirectory is reported by its relative path and the walk continues', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findObserved-'));
  const locked = join(dir, 'outer', 'locked');
  try {
    mkdirSync(locked, { recursive: true });
    put(join(dir, 'open', NAME));
    chmodSync(locked, 0o000);
    assert.deepEqual(findObserved(dir), {
      files: [join(dir, 'open', NAME)],
      failures: [{ path: join('outer', 'locked'), why: 'EACCES' }],
    });
  } finally {
    chmodSync(locked, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the observed file is found at the root and in deeply nested directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findObserved-'));
  try {
    put(join(dir, NAME));
    put(join(dir, 'a', 'b', 'c', NAME));
    assert.deepEqual(findObserved(dir), {
      files: [join(dir, 'a', 'b', 'c', NAME), join(dir, NAME)],
      failures: [],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('files from several directories come back in sorted order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findObserved-'));
  try {
    put(join(dir, 'z', NAME));
    put(join(dir, NAME));
    put(join(dir, 'a', NAME));
    put(join(dir, 'B', NAME));
    assert.deepEqual(findObserved(dir), {
      files: [join(dir, 'B', NAME), join(dir, 'a', NAME), join(dir, NAME), join(dir, 'z', NAME)],
      failures: [],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only the exact file name is collected among its neighbours', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findObserved-'));
  try {
    put(join(dir, NAME));
    put(join(dir, 'other.json'));
    put(join(dir, 'egress-observed.txt'));
    put(join(dir, 'sub', `${NAME}.bak`));
    assert.deepEqual(findObserved(dir), { files: [join(dir, NAME)], failures: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('node_modules, .git and egress directories are skipped at any depth but similar names are not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findObserved-'));
  try {
    put(join(dir, 'node_modules', NAME));
    put(join(dir, '.git', NAME));
    put(join(dir, 'egress', NAME));
    put(join(dir, 'kept', 'node_modules', NAME));
    put(join(dir, 'kept', NAME));
    put(join(dir, 'egress-logs', NAME));
    assert.deepEqual(findObserved(dir), {
      files: [join(dir, 'egress-logs', NAME), join(dir, 'kept', NAME)],
      failures: [],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('symbolic links to a directory or to an observed file are neither followed nor listed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findObserved-'));
  try {
    const outside = join(dir, 'outside');
    const root = join(dir, 'root');
    put(join(outside, NAME));
    mkdirSync(root);
    symlinkSync(outside, join(root, 'link'));
    symlinkSync(join(outside, NAME), join(root, NAME));
    assert.deepEqual(findObserved(root), { files: [], failures: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a directory named like the observed file is walked and not listed itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findObserved-'));
  try {
    put(join(dir, NAME, NAME));
    assert.deepEqual(findObserved(dir), { files: [join(dir, NAME, NAME)], failures: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
