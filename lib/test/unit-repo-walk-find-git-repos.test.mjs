// Sorted git repo paths found under the given roots, plus walk errors and missing roots (lib/repo-walk.mjs findGitRepos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findGitRepos } from '../repo-walk.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'findGitRepos-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeRepo(...parts) {
  mkdirSync(join(...parts, '.git'), { recursive: true });
  return join(...parts);
}

test('Null or empty roots give an empty result with no errors and no missing roots', () => {
  assert.deepEqual(findGitRepos(null), { repos: [], errors: [], missingRoots: [] });
  assert.deepEqual(findGitRepos([]), { repos: [], errors: [], missingRoots: [] });
});

test('A root that does not exist is reported in missingRoots and is not walked', () => {
  withDir((dir) => {
    const missing = join(dir, 'does-not-exist');
    const r = findGitRepos([missing]);
    assert.deepEqual(r, { repos: [], errors: [], missingRoots: [missing] });
  });
});

test('A root that is itself a repo is listed once even when given twice', () => {
  withDir((dir) => {
    const repo = makeRepo(dir, 'myrepo');
    const r = findGitRepos([repo, repo]);
    assert.deepEqual(r, { repos: [repo], errors: [], missingRoots: [] });
  });
});

test('A .git file rather than a .git directory does not make a repository', () => {
  withDir((dir) => {
    const wt = join(dir, 'wt');
    mkdirSync(wt);
    writeFileSync(join(wt, '.git'), 'gitdir: elsewhere\n');
    const r = findGitRepos([wt]);
    assert.deepEqual(r, { repos: [], errors: [], missingRoots: [] });
  });
});

test('With the default maxDepth a .git at depth 5 is found and a .git at depth 6 is not', () => {
  withDir((dir) => {
    const shallow = makeRepo(dir, 'a', 'b', 'c', 'd');
    makeRepo(dir, 'x', 'b', 'c', 'd', 'e');
    const r = findGitRepos([dir]);
    assert.deepEqual(r, { repos: [shallow], errors: [], missingRoots: [] });
  });
});

test('An explicit maxDepth of 1 keeps only the root repo while maxDepth 2 also finds its child', () => {
  withDir((dir) => {
    mkdirSync(join(dir, '.git'));
    const child = makeRepo(dir, 'child');
    assert.deepEqual(findGitRepos([dir], { maxDepth: 1 }), { repos: [dir], errors: [], missingRoots: [] });
    assert.deepEqual(findGitRepos([dir], { maxDepth: 2 }), { repos: [dir, child], errors: [], missingRoots: [] });
  });
});

test('Prune defaults to node_modules and a custom prune list replaces the default', () => {
  withDir((dir) => {
    const nm = makeRepo(dir, 'node_modules', 'pkg');
    const src = makeRepo(dir, 'src', 'app');
    assert.deepEqual(findGitRepos([dir]), { repos: [src], errors: [], missingRoots: [] });
    assert.deepEqual(findGitRepos([dir], { prune: ['src'] }), { repos: [nm], errors: [], missingRoots: [] });
  });
});

test('Skip drops repos with a matching whole path segment and the rest come back sorted', () => {
  withDir((dir) => {
    const vendored = makeRepo(dir, 'vendor', 'lib');
    const b = makeRepo(dir, 'b');
    const a = makeRepo(dir, 'a');
    assert.deepEqual(findGitRepos([dir], { skip: ['vendor'] }), { repos: [a, b], errors: [], missingRoots: [] });
    assert.deepEqual(findGitRepos([dir], { skip: ['vend'] }), { repos: [a, b, vendored], errors: [], missingRoots: [] });
  });
});

test('Relative roots are resolved against cwd and a missing one is reported at its absolute path', () => {
  withDir((dir) => {
    const repo = makeRepo(dir, 'relrepo');
    const r = findGitRepos(['relrepo', 'gone'], { cwd: dir });
    assert.deepEqual(r, { repos: [repo], errors: [], missingRoots: [join(dir, 'gone')] });
  });
});

test('A root that is a plain file is walked and its read error is recorded as ENOTDIR', () => {
  withDir((dir) => {
    const f = join(dir, 'plain.txt');
    writeFileSync(f, 'x');
    const r = findGitRepos([f]);
    assert.deepEqual(r, { repos: [], errors: [{ path: f, code: 'ENOTDIR' }], missingRoots: [] });
  });
});
