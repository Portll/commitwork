// Maps a project label or slug to its canonical registry slug, or a sanitized URL-safe slug (monitor/project-scope.mjs projectSlug).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectSlug } from '../project-scope.mjs';

test('returns empty string for null input', () => {
  assert.equal(projectSlug(null), '');
});

test('returns empty string for undefined input', () => {
  assert.equal(projectSlug(undefined), '');
});

test('returns empty string for empty string input', () => {
  assert.equal(projectSlug(''), '');
});

test('sanitizes spaces and special characters to hyphens', () => {
  assert.equal(projectSlug('My Project'), 'my-project');
});

test('sanitizes multiple consecutive special characters to single hyphen', () => {
  assert.equal(projectSlug('a  b'), 'a-b');
});

test('removes leading and trailing hyphens', () => {
  assert.equal(projectSlug('--hello--'), 'hello');
});

test('returns empty string when result is all hyphens', () => {
  assert.equal(projectSlug('!!!'), '');
});

test('preserves existing hyphens in input', () => {
  assert.equal(projectSlug('my-project'), 'my-project');
});

test('sanitizes mixed special characters', () => {
  assert.equal(projectSlug('Hello World!'), 'hello-world');
});

test('sanitizes digits and letters correctly', () => {
  assert.equal(projectSlug('A1B2'), 'a1b2');
});
