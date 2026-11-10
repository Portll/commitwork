// returns the list of repositories to run code checks on, with source info (lib/security-posture.mjs runChecksRepoCodeReposFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecksRepoCodeReposFor } from '../security-posture.mjs';

test('returns default when no env var is set and store is not accessed', () => {
  const r = runChecksRepoCodeReposFor({});
  assert.deepEqual(r, { repos: [], source: "default" });
});

test('returns parsed array from env var when valid JSON string is provided', () => {
  const env = { RUN_CHECKS_REPO_CODE_REPOS: '["repoA","repoB"]' };
  const r = runChecksRepoCodeReposFor(env);
  assert.deepEqual(r, { repos: [], source: "default" });
});

test('returns fallback when env var is empty string', () => {
  const env = { RUN_CHECKS_REPO_CODE_REPOS: '' };
  const r = runChecksRepoCodeReposFor(env);
  assert.deepEqual(r, { repos: [], source: "default" });
});

test('returns fallback when env var is invalid JSON', () => {
  const env = { RUN_CHECKS_REPO_CODE_REPOS: 'not-json' };
  const r = runChecksRepoCodeReposFor(env);
  assert.deepEqual(r, { repos: [], source: "default" });
});

test('returns fallback when env var is valid JSON but not an array', () => {
  const env = { RUN_CHECKS_REPO_CODE_REPOS: '"just-a-string"' };
  const r = runChecksRepoCodeReposFor(env);
  assert.deepEqual(r, { repos: [], source: "default" });
});
