// Root is reserved. docs-doctor gates the Markdown there; this gates everything else, because the
// 4 MB Erlang crash dump and the sqlite store that sat in root for six weeks (found 2026-10-13) were
// neither Markdown nor ignored, one `git add -A` from a published tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.CW_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ROOT_FILES = new Set([
  'README.md', 'CLAUDE.md', 'LICENSING.md', 'LICENSE', 'LICENSE-APACHE-2.0',
  'package.json', 'package-lock.json', 'action.yml',
  '.gitignore', '.gitattributes', '.gitleaks.toml', '.gitleaksignore', '.pre-commit-hooks.yaml', '.semgrepignore',
]);

const git = (...args) => {
  const r = spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.trim()}`);
  return r.stdout.split('\n').filter(Boolean);
};

test('every tracked root file is one the root is declared to hold', () => {
  const stray = git('ls-files').filter((p) => !p.includes('/') && !ROOT_FILES.has(p));
  assert.deepEqual(stray, [], 'tracked in root but not declared here: move it into its module, or add it to ROOT_FILES with the reason root is its home');
});

test('nothing sits in root untracked and unignored', () => {
  const entries = git('status', '--porcelain', '--untracked-files=normal')
    .filter((l) => l.startsWith('?? '))
    .map((l) => l.slice(3))
    .filter((p) => !p.slice(0, -1).includes('/'));
  assert.deepEqual(entries, [], 'untracked in root and not ignored: a stray `git add -A` publishes it. Delete it, move it, or ignore it with a reason');
});
