// Sorted paths of yarn.lock and package-lock.json files found under a root directory (bin/dep-provenance.mjs findLockfiles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLockfiles } from '../dep-provenance.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'findLockfiles-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function touch(dir, ...parts) {
  mkdirSync(join(dir, ...parts.slice(0, -1)), { recursive: true });
  writeFileSync(join(dir, ...parts), '');
}

test('the default depth limit of 6 includes a lockfile six directories down and excludes one seven down', () => {
  withDir((dir) => {
    const chain = Array.from({ length: 7 }, (_, i) => 'd' + (i + 1));
    touch(dir, ...chain.slice(0, 6), 'yarn.lock');
    touch(dir, ...chain, 'yarn.lock');
    assert.deepEqual(findLockfiles(dir), [join(dir, ...chain.slice(0, 6), 'yarn.lock')]);
  });
});

test('an explicit maxDepth of 1 includes the root and first-level directories but not the second level', () => {
  withDir((dir) => {
    touch(dir, 'package-lock.json');
    touch(dir, 'a', 'yarn.lock');
    touch(dir, 'a', 'b', 'yarn.lock');
    assert.deepEqual(findLockfiles(dir, 1), [
      join(dir, 'a', 'yarn.lock'),
      join(dir, 'package-lock.json'),
    ]);
  });
});

test('a maxDepth of 0 reports only lockfiles directly in the root', () => {
  withDir((dir) => {
    touch(dir, 'yarn.lock');
    touch(dir, 'sub', 'yarn.lock');
    assert.deepEqual(findLockfiles(dir, 0), [join(dir, 'yarn.lock')]);
  });
});

test('dot directories are skipped except .yarn, and .git stays ignored', () => {
  withDir((dir) => {
    touch(dir, '.yarn', 'yarn.lock');
    touch(dir, '.hidden', 'yarn.lock');
    touch(dir, '.git', 'yarn.lock');
    assert.deepEqual(findLockfiles(dir), [join(dir, '.yarn', 'yarn.lock')]);
  });
});

test('ignored directory names are not descended into while ordinary directories are', () => {
  withDir((dir) => {
    for (const name of ['node_modules', 'dist', 'build', 'vendor', 'coverage', 'target']) {
      touch(dir, name, 'yarn.lock');
    }
    touch(dir, 'src', 'yarn.lock');
    assert.deepEqual(findLockfiles(dir), [join(dir, 'src', 'yarn.lock')]);
  });
});

test('only files named exactly yarn.lock or package-lock.json are reported, in sorted order', () => {
  withDir((dir) => {
    touch(dir, 'yarn.lock');
    touch(dir, 'package-lock.json');
    touch(dir, 'package.json');
    touch(dir, 'yarn.lock.bak');
    touch(dir, 'pnpm-lock.yaml');
    touch(dir, 'a', 'yarn.lock');
    assert.deepEqual(findLockfiles(dir), [
      join(dir, 'a', 'yarn.lock'),
      join(dir, 'package-lock.json'),
      join(dir, 'yarn.lock'),
    ]);
  });
});

test('a directory named yarn.lock is walked rather than reported', () => {
  withDir((dir) => {
    touch(dir, 'yarn.lock', 'package-lock.json');
    assert.deepEqual(findLockfiles(dir), [join(dir, 'yarn.lock', 'package-lock.json')]);
  });
});

test('an empty, missing or non-directory root yields an empty array', () => {
  withDir((dir) => {
    assert.deepEqual(findLockfiles(dir), []);
    assert.deepEqual(findLockfiles(join(dir, 'missing')), []);
    touch(dir, 'yarn.lock');
    assert.deepEqual(findLockfiles(join(dir, 'yarn.lock')), []);
  });
});
