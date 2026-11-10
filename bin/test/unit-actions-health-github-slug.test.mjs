// Extracts owner/repo from a GitHub URL (bin/actions-health.mjs githubSlug).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubSlug } from '../actions-health.mjs';

test('parses standard https github URL with .git suffix', () => {
  assert.equal(githubSlug('https://github.com/facebook/react.git'), 'facebook/react');
});

test('parses standard https github URL without .git suffix', () => {
  assert.equal(githubSlug('https://github.com/facebook/react'), 'facebook/react');
});

test('parses git protocol URL', () => {
  assert.equal(githubSlug('git@github.com:facebook/react.git'), 'facebook/react');
});

test('parses URL with trailing slash', () => {
  assert.equal(githubSlug('https://github.com/facebook/react/'), 'facebook/react');
});

test('parses URL with .git and trailing slash', () => {
  assert.equal(githubSlug('https://github.com/facebook/react.git/'), 'facebook/react');
});

test('returns null for non-github URL', () => {
  assert.equal(githubSlug('https://gitlab.com/facebook/react.git'), null);
});

test('returns null for empty string', () => {
  assert.equal(githubSlug(''), null);
});

test('returns null for null input', () => {
  assert.equal(githubSlug(null), null);
});

test('returns null for undefined input', () => {
  assert.equal(githubSlug(undefined), null);
});

test('trims whitespace around URL', () => {
  assert.equal(githubSlug('  https://github.com/facebook/react  '), 'facebook/react');
});
