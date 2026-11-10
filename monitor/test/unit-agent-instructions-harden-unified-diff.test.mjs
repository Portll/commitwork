// Computes a unified diff for in-line edits (monitor/agent-instructions-harden.mjs unifiedDiff).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unifiedDiff } from '../agent-instructions-harden.mjs';

test('returns empty string when no lines differ', () => {
  const r = unifiedDiff('f.txt', 'a\nb\nc\n', 'a\nb\nc\n');
  assert.equal(r, "");
});

test('throws when line counts differ', () => {
  assert.throws(() => unifiedDiff('f.txt', 'a\nb\n', 'a\n'), { name: "Error", message: "f.txt: line count changed (2 -> 1); this diff builder only handles in-line edits" });
});

test('detects change on first line', () => {
  const r = unifiedDiff('f.txt', 'a\nb\nc\nd\ne\nf\ng\n', 'x\nb\nc\nd\ne\nf\ng\n');
  assert.equal(r, "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,4 +1,4 @@\n-a\n+x\n b\n c\n d\n");
});

test('merges changes within context distance into one hunk', () => {
  const r = unifiedDiff('f.txt', 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\n', 'a\nb\nX\nd\ne\nf\nY\nh\ni\nj\nk\n');
  assert.equal(r, "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,10 +1,10 @@\n a\n b\n-c\n+X\n d\n e\n f\n-g\n+Y\n h\n i\n j\n");
});

test('splits changes beyond context distance into separate hunks', () => {
  const r = unifiedDiff('f.txt', 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\np\nq\nr\ns\nt\nu\nv\nw\nx\ny\nz\n', 'a\nb\nX\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\np\nq\nr\ns\nt\nu\nv\nw\nx\nY\nz\n');
  assert.equal(r, "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,6 +1,6 @@\n a\n b\n-c\n+X\n d\n e\n f\n@@ -22,5 +22,5 @@\n v\n w\n x\n-y\n+Y\n z\n");
});

test('handles missing newline at end of file in context lines', () => {
  const r = unifiedDiff('f.txt', 'a\nb\nc\nd\ne\nf\ng', 'a\nb\nc\nd\nX\nf\ng');
  assert.equal(r, "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -2,6 +2,6 @@\n b\n c\n d\n-e\n+X\n f\n g\n\\ No newline at end of file\n");
});

test('handles missing newline at end of file in changed lines', () => {
  const r = unifiedDiff('f.txt', 'a\nb\nc\nd\ne\nf\ng', 'a\nb\nc\nd\ne\nf\nY');
  assert.equal(r, "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -4,4 +4,4 @@\n d\n e\n f\n-g\n\\ No newline at end of file\n+Y\n\\ No newline at end of file\n");
});

test('handles change on last line with trailing newline', () => {
  const r = unifiedDiff('f.txt', 'a\nb\nc\nd\ne\nf\ng\n', 'a\nb\nc\nd\ne\nf\nY\n');
  assert.equal(r, "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -4,4 +4,4 @@\n d\n e\n f\n-g\n+Y\n");
});

test('handles single line file with trailing newline', () => {
  const r = unifiedDiff('f.txt', 'a\n', 'x\n');
  assert.equal(r, "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-a\n+x\n");
});

test('handles single line file without trailing newline', () => {
  const r = unifiedDiff('f.txt', 'a', 'x');
  assert.equal(r, "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+x\n\\ No newline at end of file\n");
});
