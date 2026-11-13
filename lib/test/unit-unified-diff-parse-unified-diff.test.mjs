// parses a unified diff into an array of file objects with hunks (lib/unified-diff.mjs parseUnifiedDiff).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUnifiedDiff } from '../unified-diff.mjs';

test('parses a simple diff with one file and one hunk', () => {
  const input = [
    'diff --git a/file.txt b/file.txt',
    '--- "a/file.txt"',
    '+++ "b/file.txt"',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n');
  const result = parseUnifiedDiff(input);
  assert.deepEqual(result, [
    {
      oldPath: 'file.txt',
      newPath: 'file.txt',
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ['-old', '+new'],
          oldNoNewline: false,
          newNoNewline: false,
        },
      ],
      created: false,
      deleted: false,
    },
  ]);
});

test('handles a no-newline-at-end-of-file marker inside a hunk', () => {
  const input = [
    'diff --git a/file.txt b/file.txt',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -1 +1 @@',
    '-old line',
    '\\ No newline at end of file',
    '+new line',
    '\\ No newline at end of file',
  ].join('\n');
  const result = parseUnifiedDiff(input);
  assert.deepEqual(result, [
    {
      oldPath: 'file.txt',
      newPath: 'file.txt',
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ['-old line', '+new line'],
          oldNoNewline: true,
          newNoNewline: true,
        },
      ],
      created: false,
      deleted: false,
    },
  ]);
});

test('recognises new file mode and sets created flag', () => {
  const input = [
    'diff --git a/dev/null b/new.txt',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/new.txt',
    '@@ -0,0 +1 @@',
    '+content',
  ].join('\n');
  const result = parseUnifiedDiff(input);
  assert.deepEqual(result, [
    {
      oldPath: null,
      newPath: 'new.txt',
      hunks: [
        {
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 1,
          lines: ['+content'],
          oldNoNewline: false,
          newNoNewline: false,
        },
      ],
      created: true,
      deleted: false,
    },
  ]);
});

test('throws when a hunk line exceeds the old side count declared in the header', () => {
  const input = [
    'diff --git a/file.txt b/file.txt',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -0,0 +1 @@',
    '-extra',
  ].join('\n');
  assert.throws(() => parseUnifiedDiff(input), { name: "Error", message: "unified diff: more hunk lines than the header declares on the old side" });
});

test('throws on a stray hunk-like line before any file header', () => {
  const input = [
    ' +orphan line',
    'diff --git a/file.txt b/file.txt',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n');
  assert.throws(() => parseUnifiedDiff(input), {
    name: 'Error',
    message: 'unified diff: hunk line before any file header',
  });
});

test('parses oldStart and oldLines from a hunk header correctly', () => {
  const input = [
    'diff --git a/file.txt b/file.txt',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -5,3 +10,2 @@',
    ' line1',
    '-line2',
    '+line3',
  ].join('\n');
  assert.throws(() => parseUnifiedDiff(input), {
    name: 'Error',
    message: 'unified diff: hunk body ends early \u2014 1 old and 0 new line(s) still owed',
  });
});

test('parses newStart and newLines from a hunk header correctly', () => {
  const input = [
    'diff --git a/file.txt b/file.txt',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -2,1 +8,4 @@',
    '-old',
    '+new1',
    '+new2',
    '+new3',
    '+new4',
  ].join('\n');
  const result = parseUnifiedDiff(input);
  assert.deepEqual(result, [
    {
      oldPath: 'file.txt',
      newPath: 'file.txt',
      hunks: [
        {
          oldStart: 2,
          oldLines: 1,
          newStart: 8,
          newLines: 4,
          lines: ['-old', '+new1', '+new2', '+new3', '+new4'],
          oldNoNewline: false,
          newNoNewline: false,
        },
      ],
      created: false,
      deleted: false,
    },
  ]);
});

test('handles a diff with only git header and no explicit ---/+++ lines', () => {
  const input = [
    'diff --git a/a.txt b/b.txt',
    '@@ -1 +1 @@',
    '-a',
    '+b',
  ].join('\n');
  const result = parseUnifiedDiff(input);
  assert.deepEqual(result, [
    {
      oldPath: 'a.txt',
      newPath: 'b.txt',
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ['-a', '+b'],
          oldNoNewline: false,
          newNoNewline: false,
        },
      ],
      created: false,
      deleted: false,
    },
  ]);
});

test('processes multiple files with separate hunks', () => {
  const input = [
    'diff --git a/first.txt b/first.txt',
    '--- a/first.txt',
    '+++ b/first.txt',
    '@@ -1 +1 @@',
    '-old1',
    '+new1',
    'diff --git a/second.txt b/second.txt',
    '--- a/second.txt',
    '+++ b/second.txt',
    '@@ -2 +2 @@',
    '-old2',
    '+new2',
  ].join('\n');
  const result = parseUnifiedDiff(input);
  assert.deepEqual(result, [
    {
      oldPath: 'first.txt',
      newPath: 'first.txt',
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ['-old1', '+new1'],
          oldNoNewline: false,
          newNoNewline: false,
        },
      ],
      created: false,
      deleted: false,
    },
    {
      oldPath: 'second.txt',
      newPath: 'second.txt',
      hunks: [
        {
          oldStart: 2,
          oldLines: 1,
          newStart: 2,
          newLines: 1,
          lines: ['-old2', '+new2'],
          oldNoNewline: false,
          newNoNewline: false,
        },
      ],
      created: false,
      deleted: false,
    },
  ]);
});

test('creates a new file entry when a second ---/+++ pair appears after a header', () => {
  const input = [
    'diff --git a/first.txt b/first.txt',
    '--- a/first.txt',
    '+++ b/first.txt',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    '--- a/second.txt',
    '+++ b/second.txt',
    '@@ -1 +1 @@',
    '-old2',
    '+new2',
  ].join('\n');
  const result = parseUnifiedDiff(input);
  assert.deepEqual(result, [
    {
      oldPath: 'first.txt',
      newPath: 'first.txt',
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ['-old', '+new'],
          oldNoNewline: false,
          newNoNewline: false,
        },
      ],
      created: false,
      deleted: false,
    },
    {
      oldPath: 'second.txt',
      newPath: 'second.txt',
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ['-old2', '+new2'],
          oldNoNewline: false,
          newNoNewline: false,
        },
      ],
      created: false,
      deleted: false,
    },
  ]);
});
