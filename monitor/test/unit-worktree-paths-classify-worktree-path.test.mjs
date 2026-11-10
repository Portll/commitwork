// Classifies a URI as a worktree path or not (monitor/worktree-paths.mjs classifyWorktreePath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWorktreePath } from '../worktree-paths.mjs';

test('returns NONE when CW_WORKTREE_PATHS is off', () => {
  const saved = process.env.CW_WORKTREE_PATHS;
  process.env.CW_WORKTREE_PATHS = 'off';
  try {
    const r = classifyWorktreePath('.claude/worktrees/a/b');
    assert.deepEqual(r, { worktree: false, pattern: null, why: null, name: null, canonical: null });
  } finally {
    if (saved === undefined) delete process.env.CW_WORKTREE_PATHS;
    else process.env.CW_WORKTREE_PATHS = saved;
  }
});

test('returns NONE for empty input', () => {
  const r = classifyWorktreePath('');
  assert.deepEqual(r, { worktree: false, pattern: null, why: null, name: null, canonical: null });
});

test('returns NONE for path without any worktree root', () => {
  const r = classifyWorktreePath('src/main.c');
  assert.deepEqual(r, { worktree: false, pattern: null, why: null, name: null, canonical: null });
});

test('classifies a .claude/worktrees path with a file inside', () => {
  const r = classifyWorktreePath('.claude/worktrees/feat-x/src/main.c');
  assert.deepEqual(r, { worktree: true, pattern: ".claude/worktrees", why: "a Claude Code agent worktree: this repository checked out again", name: "feat-x", canonical: "src/main.c" });
});

test('returns NONE when the worktree directory has no file inside', () => {
  const r = classifyWorktreePath('.claude/worktrees/feat-x');
  assert.deepEqual(r, { worktree: false, pattern: null, why: null, name: null, canonical: null });
});

test('returns NONE when the root segment is not at a segment boundary', () => {
  const r = classifyWorktreePath('vendor/x.claude/worktrees/a/b');
  assert.deepEqual(r, { worktree: false, pattern: null, why: null, name: null, canonical: null });
});

test('classifies a .git/worktrees path with a file inside', () => {
  const r = classifyWorktreePath('.git/worktrees/wt1/file.txt');
  assert.deepEqual(r, { worktree: true, pattern: ".git/worktrees", why: "git's own worktree administrative directory", name: "wt1", canonical: "file.txt" });
});

test('classifies a .git path with a file inside', () => {
  const r = classifyWorktreePath('.git/gate-head-1234/HEAD');
  assert.deepEqual(r, { worktree: true, pattern: ".git", why: "a checkout parked inside git's own directory, never this repository's source", name: "gate-head-1234", canonical: "HEAD" });
});
