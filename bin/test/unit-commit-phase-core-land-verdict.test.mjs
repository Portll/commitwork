// Decides whether a staged index may be committed (bin/commit-phase-core.mjs landVerdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landVerdict } from '../commit-phase-core.mjs';

test('returns no-declaration when declared is an empty array', () => {
  const r = landVerdict({ declared: [], headAtReadTree: 'a', headNow: 'a', stagedCount: 1 });
  assert.deepEqual(r, { verdict: 'no-declaration', exit: 2, why: 'no declared paths. The staged set is NOT a substitute \u2014 the shared index holds other sessions\' staging, which is the defect this closes.' });
});

test('returns no-declaration when declared is not an array', () => {
  const r = landVerdict({ declared: 'x', headAtReadTree: 'a', headNow: 'a', stagedCount: 1 });
  assert.deepEqual(r, { verdict: 'no-declaration', exit: 2, why: 'no declared paths. The staged set is NOT a substitute \u2014 the shared index holds other sessions\' staging, which is the defect this closes.' });
});

test('returns no-declaration when a declared path is absolute', () => {
  const r = landVerdict({ declared: ['/etc/passwd'], headAtReadTree: 'a', headNow: 'a', stagedCount: 1 });
  assert.deepEqual(r, { verdict: 'no-declaration', exit: 2, why: 'declared path escapes the repo or is empty: "/etc/passwd"' });
});

test('returns no-declaration when a declared path contains a parent traversal', () => {
  const r = landVerdict({ declared: ['a/../b'], headAtReadTree: 'a', headNow: 'a', stagedCount: 1 });
  assert.deepEqual(r, { verdict: 'no-declaration', exit: 2, why: 'declared path escapes the repo or is empty: "a/../b"' });
});

test('returns no-declaration when a declared path is an empty string', () => {
  const r = landVerdict({ declared: [''], headAtReadTree: 'a', headNow: 'a', stagedCount: 1 });
  assert.deepEqual(r, { verdict: 'no-declaration', exit: 2, why: 'declared path escapes the repo or is empty: ""' });
});

test('returns no-declaration when a declared path is not a string', () => {
  const r = landVerdict({ declared: [42], headAtReadTree: 'a', headNow: 'a', stagedCount: 1 });
  assert.deepEqual(r, { verdict: 'no-declaration', exit: 2, why: 'declared path escapes the repo or is empty: 42' });
});

test('returns unknown-head when headAtReadTree is an empty string', () => {
  const r = landVerdict({ declared: ['a'], headAtReadTree: '', headNow: 'b', stagedCount: 1 });
  assert.deepEqual(r, { verdict: 'unknown-head', exit: 2, why: 'HEAD could not be read at one or both ends. Refusing: an unknown is not "unchanged", and committing a private index against an unknown HEAD is how the old-blob revert happens.' });
});

test('returns unknown-head when headNow is not a string', () => {
  const r = landVerdict({ declared: ['a'], headAtReadTree: 'b', headNow: 123, stagedCount: 1 });
  assert.deepEqual(r, { verdict: 'unknown-head', exit: 2, why: 'HEAD could not be read at one or both ends. Refusing: an unknown is not "unchanged", and committing a private index against an unknown HEAD is how the old-blob revert happens.' });
});

test('returns stale-index when headAtReadTree differs from headNow', () => {
  const r = landVerdict({ declared: ['a'], headAtReadTree: 'abc1234def', headNow: 'xyz9876ghi', stagedCount: 1 });
  assert.deepEqual(r, { verdict: 'stale-index', exit: 2, headAtReadTree: 'abc1234def', headNow: 'xyz9876ghi', why: 'HEAD moved abc1234 \u2192 xyz9876 since this index was built from it. The index still carries the OLD blob for every path that commit touched, so landing it would revert that session\'s work with a clean-looking diff. Re-run: the read-tree is cheap and re-reading is the fix.' });
});

test('returns nothing-staged when stagedCount is zero and heads match', () => {
  const r = landVerdict({ declared: ['a'], headAtReadTree: 'abc1234def', headNow: 'abc1234def', stagedCount: 0 });
  assert.deepEqual(r, { verdict: 'nothing-staged', exit: 1, why: 'the declared paths produced no change against HEAD \u2014 nothing to commit.' });
});

test('returns land when heads match and stagedCount is one', () => {
  const r = landVerdict({ declared: ['a'], headAtReadTree: 'abc1234def', headNow: 'abc1234def', stagedCount: 1 });
  assert.deepEqual(r, { verdict: 'land', exit: 0, head: 'abc1234def' });
});
