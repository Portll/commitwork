// Resolves the runChecksRepoCode posture setting from env or store (lib/security-posture.mjs runChecksRepoCodeFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecksRepoCodeFor } from '../security-posture.mjs';

test('returns the strict fallback when the env value is invalid', () => {
  assert.deepEqual(runChecksRepoCodeFor({ COMMITWORK_RUN_CHECKS_REPO_CODE: 'bogus' }), { mode: "opt-in", source: "default" });
});

test('returns the strict fallback when the env value is empty after trimming', () => {
  assert.deepEqual(runChecksRepoCodeFor({ COMMITWORK_RUN_CHECKS_REPO_CODE: '   ' }), { mode: "opt-in", source: "default" });
});

test('returns the strict fallback when the env value is whitespace only', () => {
  assert.deepEqual(runChecksRepoCodeFor({ COMMITWORK_RUN_CHECKS_REPO_CODE: '\t\n' }), { mode: "opt-in", source: "default" });
});

test('returns the strict fallback when the env value is a long invalid token', () => {
  assert.deepEqual(runChecksRepoCodeFor({ COMMITWORK_RUN_CHECKS_REPO_CODE: 'x'.repeat(64) }), { mode: "opt-in", source: "default" });
});

test('returns the strict fallback when the env value is a single invalid character', () => {
  assert.deepEqual(runChecksRepoCodeFor({ COMMITWORK_RUN_CHECKS_REPO_CODE: '?' }), { mode: "opt-in", source: "default" });
});

test('returns the strict fallback when the env value is a number-like string', () => {
  assert.deepEqual(runChecksRepoCodeFor({ COMMITWORK_RUN_CHECKS_REPO_CODE: '123' }), { mode: "opt-in", source: "default" });
});

test('returns the strict fallback when the env value is a boolean-like string', () => {
  assert.deepEqual(runChecksRepoCodeFor({ COMMITWORK_RUN_CHECKS_REPO_CODE: 'true' }), { mode: "opt-in", source: "default" });
});

test('returns the strict fallback when the env value is a JSON-like string', () => {
  assert.deepEqual(runChecksRepoCodeFor({ COMMITWORK_RUN_CHECKS_REPO_CODE: '"opt-in"' }), { mode: "opt-in", source: "default" });
});
