// determines if a repository opts out of automated PRs (monitor/draft-pr-gates.mjs optOut)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optOut } from '../draft-pr-gates.mjs';

test('returns null when files is falsy', () => {
  const result = optOut({ files: null, labels: [] });
  assert.deepEqual(result, { optedOut: null, why: "the default branch files could not be read" });
});

test('continues when files is truthy', () => {
  const result = optOut({ files: {}, labels: [] });
  assert.deepEqual(result, { optedOut: false, why: "no opt-out found" });
});

test('returns null when labels is not an array', () => {
  const result = optOut({ files: {}, labels: null });
  assert.deepEqual(result, { optedOut: null, why: "the label list could not be read" });
});

test('continues when labels is an array', () => {
  const result = optOut({ files: {}, labels: [] });
  assert.deepEqual(result, { optedOut: false, why: "no opt-out found" });
});

test('detects presence of an opt\u2011out marker file', () => {
  const files = { '.github/no-automated-prs': 'present' };
  const result = optOut({ files, labels: [] });
  assert.deepEqual(result, { optedOut: true, why: ".github/no-automated-prs is present" });
});

test('does not find a marker file when none are present', () => {
  const files = { 'README.md': 'content' };
  const result = optOut({ files, labels: [] });
  assert.deepEqual(result, { optedOut: false, why: "no opt-out found" });
});

test('detects an opt\u2011out label', () => {
  const result = optOut({ files: {}, labels: ['no bots'] });
  assert.deepEqual(result, { optedOut: true, why: "the repository has a \"no bots\" label" });
});

test('does not treat non\u2011matching label as opt\u2011out', () => {
  const result = optOut({ files: {}, labels: ['enhancement'] });
  assert.deepEqual(result, { optedOut: false, why: "no opt-out found" });
});

test('returns default when no opt\u2011out found', () => {
  const result = optOut({ files: {}, labels: [] });
  assert.deepEqual(result, { optedOut: false, why: "no opt-out found" });
});
