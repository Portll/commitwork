// Builds a unified diff header and body from file, start line, and before/after lines (bin/comment-suggest.mjs unified).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from '../comment-suggest.mjs';

test('produces correct output for single line before and after', () => {
  const result = unified('src/index.js', 10, ['old'], ['new']);
  const expected = [
    '--- a/src/index.js',
    '+++ b/src/index.js',
    '@@ -10,1 +10,1 @@',
    '-old',
    '+new'
  ].join('\n');
  assert.equal(result, expected);
});

test('handles empty before array', () => {
  const result = unified('test.js', 5, [], ['added']);
  const expected = [
    '--- a/test.js',
    '+++ b/test.js',
    '@@ -5,0 +5,1 @@',
    '+added'
  ].join('\n');
  assert.equal(result, expected);
});

test('handles empty after array', () => {
  const result = unified('test.js', 5, ['removed'], []);
  const expected = [
    '--- a/test.js',
    '+++ b/test.js',
    '@@ -5,1 +5,0 @@',
    '-removed'
  ].join('\n');
});

test('handles both before and after empty', () => {
  const result = unified('empty.js', 1, [], []);
  const expected = [
    '--- a/empty.js',
    '+++ b/empty.js',
    '@@ -1,0 +1,0 @@'
  ].join('\n');
  assert.equal(result, expected);
});

test('handles multiple lines in before and after', () => {
  const before = ['line1', 'line2', 'line3'];
  const after = ['new1', 'new2'];
  const result = unified('multi.js', 100, before, after);
  const expected = [
    '--- a/multi.js',
    '+++ b/multi.js',
    '@@ -100,3 +100,2 @@',
    '-line1',
    '-line2',
    '-line3',
    '+new1',
    '+new2'
  ].join('\n');
  assert.equal(result, expected);
});

test('uses start line in header correctly', () => {
  const result = unified('file.js', 42, ['a'], ['b']);
  const expected = [
    '--- a/file.js',
    '+++ b/file.js',
    '@@ -42,1 +42,1 @@',
    '-a',
    '+b'
  ].join('\n');
  assert.equal(result, expected);
});

test('handles file path with subdirectories', () => {
  const result = unified('src/utils/helper.js', 1, ['x'], ['y']);
  const expected = [
    '--- a/src/utils/helper.js',
    '+++ b/src/utils/helper.js',
    '@@ -1,1 +1,1 @@',
    '-x',
    '+y'
  ].join('\n');
  assert.equal(result, expected);
});

test('handles zero start line', () => {
  const result = unified('zero.js', 0, ['a'], ['b']);
  const expected = [
    '--- a/zero.js',
    '+++ b/zero.js',
    '@@ -0,1 +0,1 @@',
    '-a',
    '+b'
  ].join('\n');
  assert.equal(result, expected);
});
