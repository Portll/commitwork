// Computes a unified diff between two file contents (monitor/agent-config-harden.mjs unifiedDiff).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unifiedDiff } from '../agent-config-harden.mjs';

test('returns empty string when before and after are identical', () => {
  const r = unifiedDiff('f.txt', 'same\n', 'same\n');
  assert.equal(r, "");
});

test('returns empty string when before and after are both empty', () => {
  const r = unifiedDiff('f.txt', '', '');
  assert.equal(r, "");
});

test('produces diff when before has trailing newline and after does not', () => {
  const r = unifiedDiff('f.txt', 'line\n', 'line');
  assert.equal(r, "--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-line\n+line\n\\ No newline at end of file\n");
});

test('produces diff when before lacks trailing newline and after has one', () => {
  const r = unifiedDiff('f.txt', 'line', 'line\n');
  assert.equal(r, "--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-line\n\\ No newline at end of file\n+line\n");
});

test('produces diff for single line change with newlines', () => {
  const r = unifiedDiff('f.txt', 'a\nb\n', 'a\nc\n');
  assert.equal(r, "--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n");
});

test('produces diff for multi-line insertion', () => {
  const r = unifiedDiff('f.txt', 'a\nb\n', 'a\nx\ny\nb\n');
  assert.equal(r, "--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,4 @@\n a\n+x\n+y\n b\n");
});

test('produces diff for multi-line deletion', () => {
  const r = unifiedDiff('f.txt', 'a\nx\ny\nb\n', 'a\nb\n');
  assert.equal(r, "--- a/f.txt\n+++ b/f.txt\n@@ -1,4 +1,2 @@\n a\n-x\n-y\n b\n");
});

test('produces diff for completely different content', () => {
  const r = unifiedDiff('f.txt', 'one\ntwo\n', 'three\nfour\n');
  assert.equal(r, "--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n-one\n-two\n+three\n+four\n");
});

test('produces diff for empty before and non-empty after', () => {
  const r = unifiedDiff('f.txt', '', 'new\n');
  assert.equal(r, "--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-\n\\ No newline at end of file\n+new\n");
});

test('produces diff for non-empty before and empty after', () => {
  const r = unifiedDiff('f.txt', 'old\n', '');
  assert.equal(r, "--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-old\n+\n\\ No newline at end of file\n");
});
