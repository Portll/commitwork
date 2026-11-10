// First existing checkout path for a repo, else the first fallback candidate (monitor/discover.mjs findRepoPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRepoPath } from '../discover.mjs';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const rel = 'org/services';

function withDir(roots, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'findRepoPath-'));
  const saved = process.env.CW_LIBRARY_ROOTS;
  try {
    const paths = roots.map((r) => join(dir, r));
    if (paths.length) process.env.CW_LIBRARY_ROOTS = paths.join(delimiter);
    else delete process.env.CW_LIBRARY_ROOTS;
    fn(dir, paths);
  } finally {
    if (saved === undefined) delete process.env.CW_LIBRARY_ROOTS;
    else process.env.CW_LIBRARY_ROOTS = saved;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns the env override path when that path exists', () => {
  withDir([], (dir) => {
    const envPath = join(dir, 'env-repo');
    mkdirSync(envPath, { recursive: true });
    assert.equal(findRepoPath(rel, envPath), envPath);
  });
});

test('returns the plain root candidate when it exists and no env value is given', () => {
  withDir(['repo-root'], (dir, [root]) => {
    mkdirSync(join(root, rel), { recursive: true });
    assert.equal(findRepoPath(rel, ''), join(root, rel));
  });
});

test('returns the Portll candidate when the plain root candidate is absent', () => {
  withDir(['repo-root'], (dir, [root]) => {
    mkdirSync(join(root, 'Portll', rel), { recursive: true });
    assert.equal(findRepoPath(rel, ''), join(root, 'Portll', rel));
  });
});

test('returns the External Portll candidate when the earlier candidates are absent', () => {
  withDir(['repo-root'], (dir, [root]) => {
    mkdirSync(join(root, 'External', 'Portll', rel), { recursive: true });
    assert.equal(findRepoPath(rel, ''), join(root, 'External', 'Portll', rel));
  });
});

test('returns the first candidate when nothing exists and no env value is given', () => {
  withDir(['repo-root'], (dir, [root]) => {
    assert.equal(findRepoPath(rel, ''), join(root, rel));
  });
});

test('returns the second candidate when nothing exists and an env value is given', () => {
  withDir(['repo-root'], (dir, [root]) => {
    const envPath = join(dir, 'env-repo');
    assert.equal(findRepoPath(rel, envPath), join(root, rel));
  });
});

test('prefers the existing env path over an existing library candidate', () => {
  withDir(['repo-root'], (dir, [root]) => {
    const envPath = join(dir, 'env-repo');
    mkdirSync(envPath, { recursive: true });
    mkdirSync(join(root, rel), { recursive: true });
    assert.equal(findRepoPath(rel, envPath), envPath);
  });
});

test('falls through an absent env path to an existing Portll candidate', () => {
  withDir(['repo-root'], (dir, [root]) => {
    const envPath = join(dir, 'env-repo');
    mkdirSync(join(root, 'Portll', rel), { recursive: true });
    assert.equal(findRepoPath(rel, envPath), join(root, 'Portll', rel));
  });
});

test('returns the candidate under the first library root when two roots both hold it', () => {
  withDir(['root1', 'root2'], (dir, [root1, root2]) => {
    mkdirSync(join(root1, rel), { recursive: true });
    mkdirSync(join(root2, rel), { recursive: true });
    assert.equal(findRepoPath(rel, ''), join(root1, rel));
  });
});

test('returns the candidate under the second library root when only it holds the repo', () => {
  withDir(['root1', 'root2'], (dir, [root1, root2]) => {
    mkdirSync(root1, { recursive: true });
    mkdirSync(join(root2, rel), { recursive: true });
    assert.equal(findRepoPath(rel, ''), join(root2, rel));
  });
});
