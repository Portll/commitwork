// Computes evidence dimensions for a taxonomy entry (bin/taxonomy-structure.mjs evidenceDims).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceDims } from '../taxonomy-structure.mjs';

test('returns all dimensions false and zero reporters for empty input', () => {
  const r = evidenceDims({}, []);
  assert.deepEqual(r, { sha: false, path: false, date: false, count: false, actor: false, matcher: false, reporters: 0, derived: false, score: 0 });
});

test('detects sha, path, date, count, actor and reporters in example text', () => {
  const c = {
    example: 'sha abc1234 path bin/lib.js date 2024-01-01 count 5 of 10 actor reporter #1',
    scoreBasis: '',
  };
  const r = evidenceDims(c, []);
  assert.deepEqual(r, { sha: true, path: true, date: true, count: true, actor: true, matcher: false, reporters: 1, derived: false, score: 5 });
});

test('detects dimensions from scoreBasis when example is empty', () => {
  const c = {
    example: '',
    scoreBasis: 'sha def5678 path lib/x.js date 2023-06-15 count 42 actor reporter #2',
  };
  const r = evidenceDims(c, []);
  assert.deepEqual(r, { sha: true, path: true, date: true, count: true, actor: true, matcher: false, reporters: 1, derived: false, score: 5 });
});

test('sets matcher true when a matcher regex matches the example', () => {
  const c = { example: 'hello world', scoreBasis: '' };
  const r = evidenceDims(c, [/hello/]);
  assert.deepEqual(r, { sha: false, path: false, date: false, count: false, actor: false, matcher: true, reporters: 0, derived: false, score: 0 });
});

test('sets matcher false when no matcher regex matches the example', () => {
  const c = { example: 'hello world', scoreBasis: '' };
  const r = evidenceDims(c, [/goodbye/]);
  assert.deepEqual(r, { sha: false, path: false, date: false, count: false, actor: false, matcher: false, reporters: 0, derived: false, score: 0 });
});

test('counts multiple distinct reporters in the text', () => {
  const c = { example: 'reporter #1 and reporter #2 and reporter #1', scoreBasis: '' };
  const r = evidenceDims(c, []);
  assert.deepEqual(r, { sha: false, path: false, date: false, count: false, actor: true, matcher: false, reporters: 2, derived: false, score: 1 });
});

test('sets derived true when text contains derived keyword', () => {
  const c = { example: 'this is derived from analysis', scoreBasis: '' };
  const r = evidenceDims(c, []);
  assert.deepEqual(r, { sha: false, path: false, date: false, count: false, actor: false, matcher: false, reporters: 0, derived: true, score: 0 });
});

test('sets derived false when text has no derived keywords', () => {
  const c = { example: 'plain text without special terms', scoreBasis: '' };
  const r = evidenceDims(c, []);
  assert.deepEqual(r, { sha: false, path: false, date: false, count: false, actor: false, matcher: false, reporters: 0, derived: false, score: 0 });
});

test('computes score as count of true dimension flags among sha path date count actor', () => {
  const c = { example: 'sha abc1234 path bin/x.js date 2024-01-01', scoreBasis: '' };
  const r = evidenceDims(c, []);
  assert.deepEqual(r, { sha: true, path: true, date: true, count: true, actor: false, matcher: false, reporters: 0, derived: false, score: 4 });
});

test('handles example with only scoreBasis content and no example string', () => {
  const c = { scoreBasis: 'sha 1234567 path docs/readme.md date 2022-12-31 count 100 actor reporter #99' };
  const r = evidenceDims(c, []);
  assert.deepEqual(r, { sha: false, path: true, date: true, count: true, actor: true, matcher: false, reporters: 1, derived: false, score: 4 });
});
