// Computes a window of file lines at a given commit (monitor/daily.mjs contextAt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextAt } from '../daily.mjs';

test('returns null when the file content is unavailable', () => {
  const cache = new Map([['sha1:file.txt', null]]);
  const result = contextAt('/repo', 'sha1', 'file.txt', 1, 2, cache);
  assert.equal(result, null);
});

test('returns null when line is zero', () => {
  const cache = new Map([['sha1:file.txt', ['a', 'b', 'c']]]);
  const result = contextAt('/repo', 'sha1', 'file.txt', 0, 2, cache);
  assert.equal(result, null);
});

test('returns null when line is negative', () => {
  const cache = new Map([['sha1:file.txt', ['a', 'b', 'c']]]);
  const result = contextAt('/repo', 'sha1', 'file.txt', -1, 2, cache);
  assert.equal(result, null);
});

test('returns null when line exceeds file length', () => {
  const cache = new Map([['sha1:file.txt', ['a', 'b', 'c']]]);
  const result = contextAt('/repo', 'sha1', 'file.txt', 4, 2, cache);
  assert.equal(result, null);
});

test('returns the full window when line is within bounds', () => {
  const cache = new Map([['sha1:file.txt', ['a', 'b', 'c', 'd', 'e']]]);
  const result = contextAt('/repo', 'sha1', 'file.txt', 3, 2, cache);
  assert.deepEqual(result, { startLine: 1, text: 'a\nb\nc\nd\ne' });
});

test('clamps startLine to 1 when line minus n is less than 1', () => {
  const cache = new Map([['sha1:file.txt', ['a', 'b', 'c', 'd', 'e']]]);
  const result = contextAt('/repo', 'sha1', 'file.txt', 1, 2, cache);
  assert.deepEqual(result, { startLine: 1, text: 'a\nb\nc' });
});

test('clamps end to file length when line plus n exceeds length', () => {
  const cache = new Map([['sha1:file.txt', ['a', 'b', 'c', 'd', 'e']]]);
  const result = contextAt('/repo', 'sha1', 'file.txt', 5, 2, cache);
  assert.deepEqual(result, { startLine: 3, text: 'c\nd\ne' });
});

test('truncates text to 2000 characters', () => {
  const longLine = 'x'.repeat(3000);
  const cache = new Map([['sha1:file.txt', [longLine]]]);
  const result = contextAt('/repo', 'sha1', 'file.txt', 1, 1, cache);
  assert.equal(result.startLine, 1);
  assert.equal(result.text.length, 2000);
  assert.equal(result.text, 'x'.repeat(2000));
});

test('uses cached lines when key exists', () => {
  const cache = new Map([['sha1:file.txt', ['cached1', 'cached2']]]);
  const result = contextAt('/repo', 'sha1', 'file.txt', 1, 1, cache);
  assert.deepEqual(result, { startLine: 1, text: 'cached1\ncached2' });
});

test('returns null for empty file content', () => {
  const cache = new Map([['sha1:file.txt', []]]);
  const result = contextAt('/repo', 'sha1', 'file.txt', 1, 2, cache);
  assert.equal(result, null);
});
