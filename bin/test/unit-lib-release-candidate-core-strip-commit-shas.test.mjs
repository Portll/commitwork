// Strips commit SHAs from release candidate text (bin/lib/release-candidate-core.mjs stripCommitShas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripCommitShas } from '../lib/release-candidate-core.mjs';

test('removes parenthesized commit lists when all tokens are commits', () => {
  const commits = new Set(['1234567', 'abcdef8']);
  const input = 'fix (1234567, abcdef8)';
  const result = stripCommitShas(input, commits);
  assert.equal(result, "fix");
});

test('keeps parenthesized lists when tokens are not commits', () => {
  const commits = new Set(['1234567']);
  const input = 'fix (1234567, 0000000)';
  const result = stripCommitShas(input, commits);
  assert.equal(result, "fix (a commit, 0000000)");
});

test('replaces backticked commit with placeholder', () => {
  const commits = new Set(['1234567']);
  const input = 'see `1234567` for details';
  const result = stripCommitShas(input, commits);
  assert.equal(result, "see a commit for details");
});

test('keeps backticked non-commit token', () => {
  const commits = new Set(['1234567']);
  const input = 'see `abcdef8` for details';
  const result = stripCommitShas(input, commits);
  assert.equal(result, "see `abcdef8` for details");
});

test('replaces slash-separated commit pair with placeholder', () => {
  const commits = new Set(['1234567', 'abcdef8']);
  const input = 'range 1234567/abcdef8';
  const result = stripCommitShas(input, commits);
  assert.equal(result, "range two commits");
});

test('keeps slash-separated pair when only one is a commit', () => {
  const commits = new Set(['1234567']);
  const input = 'range 1234567/abcdef8';
  const result = stripCommitShas(input, commits);
  assert.equal(result, "range 1234567/abcdef8");
});

test('replaces standalone commit token with placeholder', () => {
  const commits = new Set(['1234567']);
  const input = 'commit 1234567 here';
  const result = stripCommitShas(input, commits);
  assert.equal(result, "commit a commit here");
});

test('keeps standalone non-commit token', () => {
  const commits = new Set(['1234567']);
  const input = 'commit abcdef8 here';
  const result = stripCommitShas(input, commits);
  assert.equal(result, "commit abcdef8 here");
});

test('handles all-digit commit token in parentheses', () => {
  const commits = new Set(['1234567']);
  const input = 'fix (1234567)';
  const result = stripCommitShas(input, commits);
  assert.equal(result, "fix");
});

test('handles 8-character commit token in parentheses', () => {
  const commits = new Set(['12345678']);
  const input = 'fix (12345678)';
  const result = stripCommitShas(input, commits);
  assert.equal(result, "fix");
});
