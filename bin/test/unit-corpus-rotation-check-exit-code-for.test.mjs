// Maps a rotation status to its process exit code (bin/corpus-rotation-check.mjs exitCodeFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exitCodeFor } from '../corpus-rotation-check.mjs';

test('returns 0 when the corpus grew', () => {
  const r = exitCodeFor({ status: 'grew' });
  assert.equal(r, 0);
});

test('returns 21 when the corpus is unchanged', () => {
  const r = exitCodeFor({ status: 'unchanged' });
  assert.equal(r, 21);
});

test('returns 2 when the status is unknown', () => {
  const r = exitCodeFor({ status: 'shrank' });
  assert.equal(r, 2);
});

test('returns 2 when the status is missing', () => {
  const r = exitCodeFor({});
  assert.equal(r, 2);
});

test('returns 2 when the status is null', () => {
  const r = exitCodeFor({ status: null });
  assert.equal(r, 2);
});

test('returns 2 when the status is an empty string', () => {
  const r = exitCodeFor({ status: '' });
  assert.equal(r, 2);
});

test('returns 2 when the status is a number', () => {
  const r = exitCodeFor({ status: 0 });
  assert.equal(r, 2);
});

test('returns 2 when the status is a boolean', () => {
  const r = exitCodeFor({ status: true });
  assert.equal(r, 2);
});
