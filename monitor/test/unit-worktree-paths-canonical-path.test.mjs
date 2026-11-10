// the path inside a worktree copy, or null (monitor/worktree-paths.mjs canonicalPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPath } from '../worktree-paths.mjs';

test('returns the inner path for a Claude worktree file', () => {
  assert.equal(canonicalPath('.claude/worktrees/alpha/src/main.js'), "src/main.js");
});

test('returns the inner path for a git worktree file', () => {
  assert.equal(canonicalPath('.git/worktrees/beta/lib/util.js'), "lib/util.js");
});

test('returns the inner path for a checkout parked inside .git', () => {
  assert.equal(canonicalPath('.git/checkout-x/src/app.js'), "src/app.js");
});

test('returns null for a plain repository file', () => {
  assert.equal(canonicalPath('src/index.js'), null);
});

test('returns null when the worktree directory is the whole path', () => {
  assert.equal(canonicalPath('.claude/worktrees/alpha'), null);
});

test('returns null for a file whose name merely contains the root segment', () => {
  assert.equal(canonicalPath('vendor/x.claude/worktrees/a/b.js'), null);
});

test('returns null for an empty input', () => {
  assert.equal(canonicalPath(''), null);
});

test('returns null for a file directly under the worktree root', () => {
  assert.equal(canonicalPath('.claude/worktrees/alpha/readme.md'), "readme.md");
});
