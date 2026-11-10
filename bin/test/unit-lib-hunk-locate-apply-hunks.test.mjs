// Applies unified-diff hunks to old text, producing the new text (bin/lib/hunk-locate.mjs applyHunks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyHunks } from '../lib/hunk-locate.mjs';

test('applies a single deletion hunk at the start of the file', () => {
  const oldText = 'a\nb\nc';
  const hunks = [{ oldStart: 1, oldLines: 1, lines: ['-a'] }];
  assert.equal(applyHunks(oldText, hunks), "b\nc");
});

test('applies a single addition hunk at the start of the file', () => {
  const oldText = 'a\nb\nc';
  const hunks = [{ oldStart: 1, oldLines: 0, lines: ['+X'] }];
  assert.equal(applyHunks(oldText, hunks), "a\nX\nb\nc");
});

test('applies a hunk with context lines in the middle of the file', () => {
  const oldText = 'a\nb\nc\nd\ne';
  const hunks = [{ oldStart: 2, oldLines: 3, lines: [' b', '-c', '+C', ' d'] }];
  assert.equal(applyHunks(oldText, hunks), "a\nb\nC\nd\ne");
});

test('applies a hunk at the end of the file with trailing context', () => {
  const oldText = 'a\nb\nc\nd\ne';
  const hunks = [{ oldStart: 4, oldLines: 2, lines: [' d', '-e', '+E'] }];
  assert.equal(applyHunks(oldText, hunks), "a\nb\nc\nd\nE");
});

test('applies multiple hunks sorted by oldStart', () => {
  const oldText = 'a\nb\nc\nd\ne\nf\ng';
  const hunks = [
    { oldStart: 5, oldLines: 1, lines: ['-e', '+E'] },
    { oldStart: 2, oldLines: 1, lines: ['-b', '+B'] }
  ];
  assert.equal(applyHunks(oldText, hunks), "a\nB\nc\nd\nE\nf\ng");
});

test('handles a hunk with zero oldLines in the middle of the file', () => {
  const oldText = 'a\nb\nc\nd';
  const hunks = [{ oldStart: 2, oldLines: 0, lines: ['+X'] }];
  assert.equal(applyHunks(oldText, hunks), "a\nb\nX\nc\nd");
});

test('handles a hunk with zero oldLines at the start of the file', () => {
  const oldText = 'a\nb\nc';
  const hunks = [{ oldStart: 1, oldLines: 0, lines: ['+X'] }];
  assert.equal(applyHunks(oldText, hunks), "a\nX\nb\nc");
});

test('handles a hunk with zero oldLines at the end of the file', () => {
  const oldText = 'a\nb\nc';
  const hunks = [{ oldStart: 3, oldLines: 0, lines: ['+X'] }];
  assert.equal(applyHunks(oldText, hunks), "a\nb\nc\nX");
});

test('handles a hunk that covers the entire file', () => {
  const oldText = 'a\nb\nc';
  const hunks = [{ oldStart: 1, oldLines: 3, lines: ['-a', '-b', '-c', '+A', '+B', '+C'] }];
  assert.equal(applyHunks(oldText, hunks), "A\nB\nC");
});

test('handles a hunk with only context lines', () => {
  const oldText = 'a\nb\nc\nd\ne';
  const hunks = [{ oldStart: 2, oldLines: 2, lines: [' b', ' c'] }];
  assert.equal(applyHunks(oldText, hunks), "a\nb\nc\nd\ne");
});
