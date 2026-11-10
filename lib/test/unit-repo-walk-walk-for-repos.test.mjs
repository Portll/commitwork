// Directories under a root that directly contain a .git directory, within a depth limit (lib/repo-walk.mjs walkForRepos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkForRepos } from '../repo-walk.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'walkForRepos-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function nest(base, n) {
  let cur = base;
  for (let i = 0; i < n; i++) cur = join(cur, 'd' + i);
  mkdirSync(cur, { recursive: true });
  return cur;
}

const ent = (name, isDir = true) => ({ name, isDirectory: () => isDir });

test('a .git directory directly in the root makes the root a repository unless maxDepth is 0', () => {
  withTmp((dir) => {
    mkdirSync(join(dir, '.git'));
    assert.deepEqual(walkForRepos(dir), { repos: [dir], errors: [] });
    assert.deepEqual(walkForRepos(dir, { maxDepth: 1 }), { repos: [dir], errors: [] });
    assert.deepEqual(walkForRepos(dir, { maxDepth: 0 }), { repos: [], errors: [] });
  });
});

test('a .git at depth exactly 5 is found with the default depth limit', () => {
  withTmp((dir) => {
    const cur = nest(dir, 4);
    mkdirSync(join(cur, '.git'));
    assert.deepEqual(walkForRepos(dir), { repos: [cur], errors: [] });
  });
});

test('a .git at depth 6 is ignored by default and found when maxDepth is 6', () => {
  withTmp((dir) => {
    const cur = nest(dir, 5);
    mkdirSync(join(cur, '.git'));
    assert.deepEqual(walkForRepos(dir), { repos: [], errors: [] });
    assert.deepEqual(walkForRepos(dir, { maxDepth: 6 }), { repos: [cur], errors: [] });
  });
});

test('node_modules is pruned by default and walked when prune is empty', () => {
  withTmp((dir) => {
    mkdirSync(join(dir, 'node_modules', '.git'), { recursive: true });
    assert.deepEqual(walkForRepos(dir), { repos: [], errors: [] });
    assert.deepEqual(walkForRepos(dir, { prune: [] }), { repos: [join(dir, 'node_modules')], errors: [] });
  });
});

test('a missing root is recorded as ENOENT at maxDepth 0 and skipped entirely at maxDepth -1', () => {
  withTmp((dir) => {
    const missing = join(dir, 'missing');
    const expected = { repos: [], errors: [{ path: missing, code: 'ENOENT' }] };
    assert.deepEqual(walkForRepos(missing), expected);
    assert.deepEqual(walkForRepos(missing, { maxDepth: 0 }), expected);
    assert.deepEqual(walkForRepos(missing, { maxDepth: -1 }), { repos: [], errors: [] });
  });
});

test('an error without a code is recorded by its name, and a thrown string by its value', () => {
  withTmp((dir) => {
    const root = join(dir, 'r');
    const typeErr = { readdirSync: () => { throw new TypeError('bad dir'); } };
    assert.deepEqual(walkForRepos(root, { fs: typeErr }), { repos: [], errors: [{ path: root, code: 'TypeError' }] });
    const str = { readdirSync: () => { throw 'boom'; } };
    assert.deepEqual(walkForRepos(root, { fs: str }), { repos: [], errors: [{ path: root, code: 'boom' }] });
  });
});

test('directories whose names differ only by letter case are walked separately', () => {
  withTmp((dir) => {
    const root = join(dir, 'r');
    const tree = new Map([
      [root, [ent('A'), ent('a')]],
      [join(root, 'A'), [ent('.git')]],
      [join(root, 'a'), [ent('.git')]],
    ]);
    const fs = { readdirSync: (p) => tree.get(p) };
    assert.deepEqual(walkForRepos(root, { fs }), { repos: [join(root, 'a'), join(root, 'A')], errors: [] });
  });
});

test('a .git that is a file does not make its directory a repository', () => {
  withTmp((dir) => {
    writeFileSync(join(dir, '.git'), 'gitdir: elsewhere\n');
    assert.deepEqual(walkForRepos(dir), { repos: [], errors: [] });
  });
});

test('a symlink to a repository is not followed, only the real directory is reported', () => {
  withTmp((dir) => {
    const target = join(dir, 'target');
    mkdirSync(join(target, '.git'), { recursive: true });
    symlinkSync(target, join(dir, 'link'));
    assert.deepEqual(walkForRepos(dir), { repos: [target], errors: [] });
  });
});

test('with maxDepth 2 a .git at depth 2 is found and one at depth 3 is not', () => {
  withTmp((dir) => {
    mkdirSync(join(dir, 'a', '.git'), { recursive: true });
    mkdirSync(join(dir, 'b', 'c', '.git'), { recursive: true });
    assert.deepEqual(walkForRepos(dir, { maxDepth: 2 }), { repos: [join(dir, 'a')], errors: [] });
  });
});
