// computes checkout paths for a given ref from porcelain output (bin/commit-phase-core.mjs checkoutsOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutsOf } from '../commit-phase-core.mjs';

test('returns matching path when worktree, branch equals ref, not bare', () => {
  const porcelain = [
    'worktree /proj',
    'branch main',
    '',
    '',
    'worktree /other',
    'branch dev',
  ].join('\n');
  const ref = 'main';
  const result = checkoutsOf(porcelain, ref);
  assert.deepEqual(result, ["/proj"]);
});

test('filters out entries marked bare', () => {
  const porcelain = [
    'worktree /bareRepo',
    'bare',
    'branch main',
    '',
    '',
    'worktree /normalRepo',
    'branch main',
  ].join('\n');
  const ref = 'main';
  const result = checkoutsOf(porcelain, ref);
  assert.deepEqual(result, ["/normalRepo"]);
});

test('filters out entries whose branch does not match ref', () => {
  const porcelain = [
    'worktree /repoA',
    'branch feature',
    '',
    '',
    'worktree /repoB',
    'branch main',
  ].join('\n');
  const ref = 'main';
  const result = checkoutsOf(porcelain, ref);
  assert.deepEqual(result, ["/repoB"]);
});

test('ignores blocks without a worktree line', () => {
  const porcelain = [
    'branch main',
    '',
    '',
    'worktree /hasPath',
    'branch main',
  ].join('\n');
  const ref = 'main';
  const result = checkoutsOf(porcelain, ref);
  assert.deepEqual(result, ["/hasPath"]);
});

test('handles field lines that are exactly the key without a space', () => {
  const porcelain = [
    'worktree',
    'branch',
    '',
    '',
    'worktree /valid',
    'branch main',
  ].join('\n');
  const ref = 'main';
  const result = checkoutsOf(porcelain, ref);
  assert.deepEqual(result, ["/valid"]);
});

test('returns empty array when porcelain is null or empty', () => {
  const result = checkoutsOf(null, 'any');
  assert.deepEqual(result, []);
});
