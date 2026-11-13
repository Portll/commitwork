// determines relationship of index/worktree to before/after (bin/commit-phase-core.mjs followAction)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followAction } from '../commit-phase-core.mjs';

test('returns "current" when both index and worktree equal after', () => {
  const input = { index: 'v1', worktree: 'v1', before: 'v0', after: 'v1' };
  const result = followAction(input);
  assert.equal(result, "current");
});

test('returns "fast-forward" when index equals after and worktree equals before', () => {
  const input = { index: 'v2', worktree: 'v0', before: 'v0', after: 'v2' };
  const result = followAction(input);
  assert.equal(result, "fast-forward");
});

test('returns "fast-forward" when index equals before and worktree equals after', () => {
  const input = { index: 'v0', worktree: 'v2', before: 'v0', after: 'v2' };
  const result = followAction(input);
  assert.equal(result, "fast-forward");
});

test('returns "left" when neither index nor worktree match before or after', () => {
  const input = { index: 'a', worktree: 'b', before: 'c', after: 'd' };
  const result = followAction(input);
  assert.equal(result, "left");
});

test('returns "left" when only index matches before and worktree matches neither', () => {
  const input = { index: 'x', worktree: 'y', before: 'x', after: 'z' };
  const result = followAction(input);
  assert.equal(result, "left");
});
