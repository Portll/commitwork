// applyUnifiedDiff computes the new file contents after applying a unified diff (lib/unified-diff.mjs applyUnifiedDiff).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyUnifiedDiff } from '../unified-diff.mjs';

test('throws when a file is both created and deleted', () => {
  const fileDiff = { created: true, deleted: true, hunks: [] };
  assert.throws(() => applyUnifiedDiff(null, fileDiff), {
    name: 'Error',
    message: 'unified diff: a file cannot be created and deleted at once'
  });
});

test('throws when creation diff is applied to non\u2011null text', () => {
  const fileDiff = { created: true, oldPath: null, hunks: [] };
  assert.throws(() => applyUnifiedDiff('something', fileDiff), {
    name: 'Error',
    message: 'unified diff: a file creation must be applied to null'
  });
});

test('throws when deletion diff is applied to null text', () => {
  const fileDiff = { deleted: true, newPath: null, hunks: [] };
  assert.throws(() => applyUnifiedDiff(null, fileDiff), {
    name: 'Error',
    message: 'unified diff: a file deletion must be applied to text'
  });
});

test('throws when in\u2011place change is applied to null', () => {
  const fileDiff = { hunks: [] };
  assert.throws(() => applyUnifiedDiff(null, fileDiff), {
    name: 'Error',
    message: 'unified diff: an in-place change cannot be applied to null'
  });
});

test('applies a simple addition hunk correctly', () => {
  const text = 'a\nb\nc';
  const fileDiff = {
    hunks: [
      {
        oldStart: 2,
        oldLines: 1,
        newStart: 2,
        newLines: 2,
        lines: [' b', '+d'],
        oldNoNewline: false,
        newNoNewline: false
      }
    ]
  };
  const result = applyUnifiedDiff(text, fileDiff);
  assert.equal(result, 'a\nb\nd\nc');
});

test('detects mismatched context line', () => {
  const text = 'a\nx\nc';
  const fileDiff = {
    hunks: [
      {
        oldStart: 2,
        oldLines: 1,
        newStart: 2,
        newLines: 1,
        lines: [' b'],
        oldNoNewline: false,
        newNoNewline: false
      }
    ]
  };
  assert.throws(() => applyUnifiedDiff(text, fileDiff), {
    name: 'Error',
    message: 'unified diff: context line does not match the text at line 2'
  });
});
