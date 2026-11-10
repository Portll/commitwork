// Extracts owner/repo slug from a GitHub URL (monitor/upstream-probe.mjs slugFromGitUrl).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugFromGitUrl } from '../upstream-probe.mjs';

test('returns null for null input', () => {
  assert.equal(slugFromGitUrl(null), null);
});

test('returns null for empty string', () => {
  assert.equal(slugFromGitUrl(''), null);
});

test('returns null for non-GitHub URL', () => {
  assert.equal(slugFromGitUrl('https://gitlab.com/foo/bar.git'), null);
});

test('returns owner/repo for HTTPS GitHub URL with .git suffix', () => {
  assert.equal(slugFromGitUrl('https://github.com/octocat/Hello-World.git'), "octocat/Hello-World");
});

test('returns owner/repo for HTTPS GitHub URL without .git suffix', () => {
  assert.equal(slugFromGitUrl('https://github.com/octocat/Hello-World'), "octocat/Hello-World");
});

test('returns owner/repo for SSH-style GitHub URL', () => {
  assert.equal(slugFromGitUrl('git@github.com:octocat/Hello-World.git'), "octocat/Hello-World");
});

test('returns owner/repo for HTTPS URL with trailing slash', () => {
  assert.equal(slugFromGitUrl('https://github.com/octocat/Hello-World/'), "octocat/Hello-World");
});

test('returns null for URL missing repository path segment', () => {
  assert.equal(slugFromGitUrl('https://github.com/octocat'), null);
});
