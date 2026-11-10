// Checks if one path is a suffix of another (monitor/sarif-read.mjs sameFile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameFile } from '../sarif-read.mjs';

test('returns true when both paths are identical', () => {
  const r = sameFile('a/b', 'a/b');
  assert.equal(r, true);
});

test('returns true when the longer path ends with the shorter path', () => {
  const r = sameFile('a/b/c', 'b/c');
  assert.equal(r, true);
});

test('returns true when the shorter path is the first argument', () => {
  const r = sameFile('b/c', 'a/b/c');
  assert.equal(r, true);
});

test('returns false when the longer path does not end with the shorter path', () => {
  const r = sameFile('a/b/c', 'd/e');
  assert.equal(r, false);
});

test('returns false when the shorter path is the first argument and does not match', () => {
  const r = sameFile('d/e', 'a/b/c');
  assert.equal(r, false);
});

test('returns true when both paths have equal length and are identical', () => {
  const r = sameFile('abc', 'abc');
  assert.equal(r, true);
});

test('returns false when both paths have equal length but differ', () => {
  const r = sameFile('abc', 'abd');
  assert.equal(r, false);
});

test('returns true when the longer path is one character longer and ends with the shorter', () => {
  const r = sameFile('xabc', 'abc');
  assert.equal(r, false);
});

test('returns false when the longer path is one character longer but does not end with the shorter', () => {
  const r = sameFile('xabc', 'abd');
  assert.equal(r, false);
});
