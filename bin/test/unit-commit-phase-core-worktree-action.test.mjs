// Determines the git worktree action for a commit phase (bin/commit-phase-core.mjs worktreeAction).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worktreeAction } from '../commit-phase-core.mjs';

test('returns absent when worktree is not a string', () => {
  const r = worktreeAction({ worktree: null, before: 'a', after: 'b' });
  assert.equal(r, "absent");
});

test('returns current when worktree equals after', () => {
  const r = worktreeAction({ worktree: 'w', before: 'a', after: 'w' });
  assert.equal(r, "current");
});

test('returns fast-forward when worktree equals before', () => {
  const r = worktreeAction({ worktree: 'w', before: 'w', after: 'x' });
  assert.equal(r, "fast-forward");
});

test('returns fast-forward when worktree equals taken string', () => {
  const r = worktreeAction({ worktree: 'w', before: 'a', after: 'b', taken: 'w' });
  assert.equal(r, "fast-forward");
});

test('returns merge when worktree differs from before and taken is not a string', () => {
  const r = worktreeAction({ worktree: 'w', before: 'a', after: 'b', taken: 42 });
  assert.equal(r, "merge");
});

test('returns merge when worktree differs from before and taken is a different string', () => {
  const r = worktreeAction({ worktree: 'w', before: 'a', after: 'b', taken: 'z' });
  assert.equal(r, "merge");
});

test('returns merge when worktree differs from before and taken is undefined', () => {
  const r = worktreeAction({ worktree: 'w', before: 'a', after: 'b' });
  assert.equal(r, "merge");
});

test('returns current when worktree equals after even if taken matches before', () => {
  const r = worktreeAction({ worktree: 'w', before: 'w', after: 'w', taken: 'w' });
  assert.equal(r, "current");
});
