// Builds a sanitized container name from slice, repo, and check (monitor/containers.mjs containerName).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containerName } from '../containers.mjs';

test('uses provided slice, repo, and check values', () => {
  const r = containerName('build', { slice: 's1', repo: 'r1' });
  assert.equal(r, "cw-s1-r1-build");
});

test('falls back to cli and repo when slice and repo are omitted', () => {
  const r = containerName('test');
  assert.equal(r, "cw-cli-repo-test");
});

test('uses CW_SLICE env var when slice is omitted', () => {
  const old = process.env.CW_SLICE;
  process.env.CW_SLICE = 'env-slice';
  try {
    const r = containerName('check', { repo: 'myrepo' });
    assert.equal(r, "cw-env-slice-myrepo-check");
  } finally {
    if (old === undefined) delete process.env.CW_SLICE;
    else process.env.CW_SLICE = old;
  }
});

test('uses CW_REPO_SLUG env var when repo is omitted', () => {
  const old = process.env.CW_REPO_SLUG;
  process.env.CW_REPO_SLUG = 'env-repo';
  try {
    const r = containerName('lint', { slice: 's2' });
    assert.equal(r, "cw-s2-env-repo-lint");
  } finally {
    if (old === undefined) delete process.env.CW_REPO_SLUG;
    else process.env.CW_REPO_SLUG = old;
  }
});

test('sanitizes special characters in check to underscores', () => {
  const r = containerName('a/b:c', { slice: 's', repo: 'r' });
  assert.equal(r, "cw-s-r-a_b_c");
});

test('truncates long inputs to 60 characters each', () => {
  const long = 'x'.repeat(100);
  const r = containerName(long, { slice: long, repo: long });
  assert.equal(r, "cw-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
});

test('handles null check value as empty string', () => {
  const r = containerName(null, { slice: 's', repo: 'r' });
  assert.equal(r, "cw-s-r-");
});

test('handles undefined check value as empty string', () => {
  const r = containerName(undefined, { slice: 's', repo: 'r' });
  assert.equal(r, "cw-s-r-");
});
