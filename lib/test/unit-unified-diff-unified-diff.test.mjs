// unified diff generation (lib/unified-diff.mjs unifiedDiff)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unifiedDiff } from '../unified-diff.mjs';

test('throws when both before and after are null', () => {
  assert.throws(
    () => unifiedDiff('file.txt', null, null),
    { name: 'TypeError', message: 'unified diff: a file cannot be created and deleted at once' }
  );
});

test('creates a new file diff when before is null', () => {
  const before = null;
  const after = 'line1\nline2\n';
  const result = unifiedDiff('new.txt', before, after);
  assert.equal(result, "diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+line1\n+line2\n");
});

test('deletes a file diff when after is null', () => {
  const before = 'old1\nold2\n';
  const after = null;
  const result = unifiedDiff('old.txt', before, after);
  assert.equal(result, "diff --git a/old.txt b/old.txt\ndeleted file mode 100644\n--- a/old.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-old1\n-old2\n");
});

test('returns empty string when before and after are identical', () => {
  const before = 'same\ncontent\n';
  const after = 'same\ncontent\n';
  const result = unifiedDiff('same.txt', before, after);
  assert.equal(result, "");
});

test('produces a diff with a single line change and default context', () => {
  const before = 'a\nb\nc\n';
  const after = 'a\nx\nc\n';
  const result = unifiedDiff('change.txt', before, after);
  assert.equal(result, "diff --git a/change.txt b/change.txt\n--- a/change.txt\n+++ b/change.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+x\n c\n");
});

test('handles files without trailing newline correctly', () => {
  const before = 'noeol';
  const after = 'noeol\n';
  const result = unifiedDiff('eol.txt', before, after);
  assert.equal(result, "diff --git a/eol.txt b/eol.txt\n--- a/eol.txt\n+++ b/eol.txt\n@@ -1,1 +1,1 @@\n-noeol\n\\ No newline at end of file\n+noeol\n");
});

test('respects a custom context size', () => {
  const before = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n') + '\n';
  const after = Array.from({ length: 10 }, (_, i) => (i === 5 ? 'changed' : `line${i}`)).join('\n') + '\n';
  const result = unifiedDiff('ctx.txt', before, after, { context: 1 });
  assert.equal(result, "diff --git a/ctx.txt b/ctx.txt\n--- a/ctx.txt\n+++ b/ctx.txt\n@@ -5,3 +5,3 @@\n line4\n-line5\n+changed\n line6\n");
});

test('produces correct hunk headers when changes are at the start and end', () => {
  const before = 'first\nmid\nlast';
  const after = 'first-mod\nmid\nlast-mod';
  const result = unifiedDiff('edges.txt', before, after);
  assert.equal(result, "diff --git a/edges.txt b/edges.txt\n--- a/edges.txt\n+++ b/edges.txt\n@@ -1,3 +1,3 @@\n-first\n+first-mod\n mid\n-last\n\\ No newline at end of file\n+last-mod\n\\ No newline at end of file\n");
});
