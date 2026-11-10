// Per-repo lockfile directory under the sidecar root (monitor/preflight-build.mjs sidecarLockDir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sidecarLockDir } from '../preflight-build.mjs';
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const checkoutLink = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'evaluations');

function checkoutSidecarRoot() {
  try {
    if (!lstatSync(checkoutLink).isSymbolicLink()) return null;
    return join(dirname(realpathSync(checkoutLink)), 'lockfiles');
  } catch {
    return null;
  }
}

function withLockRoot(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sidecarLockDir-'));
  try {
    const lockRoot = join(dir, 'locks');
    mkdirSync(lockRoot);
    fn(dir, lockRoot);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('joins CW_LOCKFILE_ROOT with the repo directory name', () => {
  withLockRoot((dir, lockRoot) => {
    const repo = join(dir, 'myrepo');
    mkdirSync(repo);
    assert.equal(sidecarLockDir(repo, { CW_LOCKFILE_ROOT: lockRoot }), join(lockRoot, 'myrepo'));
  });
});

test('keeps only the last segment of a nested repo path', () => {
  withLockRoot((dir, lockRoot) => {
    const repo = join(dir, 'a', 'b', 'deep-repo');
    mkdirSync(repo, { recursive: true });
    assert.equal(sidecarLockDir(repo, { CW_LOCKFILE_ROOT: lockRoot }), join(lockRoot, 'deep-repo'));
  });
});

test('drops a trailing slash from the repo path before taking its name', () => {
  withLockRoot((dir, lockRoot) => {
    const repo = join(dir, 'myrepo');
    mkdirSync(repo);
    assert.equal(sidecarLockDir(`${repo}/`, { CW_LOCKFILE_ROOT: lockRoot }), join(lockRoot, 'myrepo'));
  });
});

test('resolves dot segments in the repo path before taking its name', () => {
  withLockRoot((dir, lockRoot) => {
    const repo = join(dir, 'myrepo');
    mkdirSync(join(repo, 'sub'), { recursive: true });
    assert.equal(sidecarLockDir(`${repo}/sub/..`, { CW_LOCKFILE_ROOT: lockRoot }), join(lockRoot, 'myrepo'));
  });
});

test('names the lock dir after a symlink rather than its target', () => {
  withLockRoot((dir, lockRoot) => {
    const target = join(dir, 'real-repo');
    const alias = join(dir, 'alias-repo');
    mkdirSync(target);
    symlinkSync(target, alias);
    assert.equal(sidecarLockDir(alias, { CW_LOCKFILE_ROOT: lockRoot }), join(lockRoot, 'alias-repo'));
  });
});

test('resolves a relative CW_LOCKFILE_ROOT against the working directory', () => {
  const r = sidecarLockDir('plain-repo', { CW_LOCKFILE_ROOT: 'rel/locks' });
  assert.equal(r, join(process.cwd(), 'rel', 'locks', 'plain-repo'));
});

test('returns the root itself when the repo path is the filesystem root', () => {
  withLockRoot((dir, lockRoot) => {
    assert.equal(sidecarLockDir('/', { CW_LOCKFILE_ROOT: lockRoot }), lockRoot);
  });
});

test('returns null for an empty, null or undefined repo path when CW_LOCKFILE_ROOT is set', () => {
  withLockRoot((dir, lockRoot) => {
    assert.equal(sidecarLockDir('', { CW_LOCKFILE_ROOT: lockRoot }), null);
    assert.equal(sidecarLockDir(null, { CW_LOCKFILE_ROOT: lockRoot }), null);
    assert.equal(sidecarLockDir(undefined, { CW_LOCKFILE_ROOT: lockRoot }), null);
  });
});

test('reads CW_LOCKFILE_ROOT from process.env when no env is passed', () => {
  withLockRoot((dir, lockRoot) => {
    const saved = process.env.CW_LOCKFILE_ROOT;
    process.env.CW_LOCKFILE_ROOT = lockRoot;
    try {
      assert.equal(sidecarLockDir(join(dir, 'myrepo')), join(lockRoot, 'myrepo'));
    } finally {
      if (saved === undefined) delete process.env.CW_LOCKFILE_ROOT;
      else process.env.CW_LOCKFILE_ROOT = saved;
    }
  });
});

test('without CW_LOCKFILE_ROOT the result follows the evaluations link of the checkout', () => {
  withLockRoot((dir) => {
    const root = checkoutSidecarRoot();
    const expected = root === null ? null : join(root, 'myrepo');
    const repo = join(dir, 'myrepo');
    mkdirSync(repo);
    assert.equal(sidecarLockDir(repo, {}), expected);
    assert.equal(sidecarLockDir(repo, { CW_LOCKFILE_ROOT: '' }), expected);
    assert.equal(sidecarLockDir('', {}), null);
  });
});
