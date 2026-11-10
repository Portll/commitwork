// Classifies a commit message into type, scope, breaking flag, description, and note (bin/changelog.mjs classify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../changelog.mjs';

test('returns null type and false breaking for a non-conventional message', () => {
  const input = 'not a conventional commit';
  const result = classify(input);
  assert.deepEqual(result, { type: null, scope: null, breaking: false, description: "not a conventional commit", note: null });
});

test('returns revert type and false breaking for a git revert message', () => {
  const input = 'revert: feat: add feature';
  const result = classify(input);
  assert.deepEqual(result, { type: "revert", scope: null, breaking: false, description: "feat: add feature", note: null });
});

test('returns null type and false breaking for a git merge message', () => {
  const input = "Merge branch 'main' into develop";
  const result = classify(input);
  assert.deepEqual(result, { type: null, scope: null, breaking: false, description: "Merge branch 'main' into develop", note: null });
});

test('returns lowercased type and breaking true for a feat with BREAKING CHANGE footer', () => {
  const input = 'feat: add new feature\n\nBREAKING CHANGE: old API removed';
  const result = classify(input);
  assert.deepEqual(result, { type: "feat", scope: null, breaking: true, description: "add new feature", note: "old API removed" });
});

test('returns lowercased type and breaking true for a feat with BREAKING-CHANGE footer', () => {
  const input = 'feat: add new feature\n\nBREAKING-CHANGE: old API removed';
  const result = classify(input);
  assert.deepEqual(result, { type: "feat", scope: null, breaking: true, description: "add new feature", note: "old API removed" });
});

test('returns lowercased type and breaking false for a feat without breaking footer', () => {
  const input = 'feat: add feature';
  const result = classify(input);
  assert.deepEqual(result, { type: "feat", scope: null, breaking: false, description: "add feature", note: null });
});

test('returns lowercased type and scope for a fix with scope', () => {
  const input = 'fix(auth): handle token expiry';
  const result = classify(input);
  assert.deepEqual(result, { type: "fix", scope: "auth", breaking: false, description: "handle token expiry", note: null });
});

test('returns parsed type for a message with a tell when checkTells is false', () => {
  const input = 'WIP: feat: add feature';
  const result = classify(input);
  assert.deepEqual(result, { type: "wip", scope: null, breaking: false, description: "feat: add feature", note: null });
});

test('returns parsed type for a message with a mood when checkMood is false', () => {
  const input = 'feat: add feature BREAKING CHANGE';
  const result = classify(input);
  assert.deepEqual(result, { type: "feat", scope: null, breaking: false, description: "add feature BREAKING CHANGE", note: null });
});

test('returns parsed type for a message with subject longer than one character when subjectMax is zero', () => {
  const input = 'feat: add feature';
  const result = classify(input);
  assert.deepEqual(result, { type: "feat", scope: null, breaking: false, description: "add feature", note: null });
});
