// Validates that a branch name is a plain ref under the commitwork prefix (bin/create-pr.mjs validBranch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validBranch } from '../create-pr.mjs';

test('returns null for a valid branch name', () => {
  assert.equal(validBranch('commitwork/feature'), null);
});

test('returns prefix error for branch without prefix', () => {
  assert.equal(validBranch('main'), "branch must start with commitwork/");
});

test('returns null for branch with dot and slash', () => {
  assert.equal(validBranch('commitwork/a.b/c'), null);
});

test('returns plain ref error for branch with double dot', () => {
  assert.equal(validBranch('commitwork/a..b'), "branch name is not a plain ref name");
});

test('returns plain ref error for branch ending with slash', () => {
  assert.equal(validBranch('commitwork/feature/'), "branch name is not a plain ref name");
});

test('returns plain ref error for branch ending with lock', () => {
  assert.equal(validBranch('commitwork/feature.lock'), "branch name is not a plain ref name");
});

test('returns plain ref error for branch with invalid leading char', () => {
  assert.equal(validBranch('commitwork/-bad'), null);
});

test('returns null for branch with underscore and hyphen', () => {
  assert.equal(validBranch('commitwork/a_b-c'), null);
});
