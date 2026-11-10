// Maps a label to its band rank (lib/chain-lexicon.mjs rankOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankOf } from '../chain-lexicon.mjs';

test('returns 0 for sound labels', () => {
  assert.equal(rankOf('intact'), 0);
});

test('returns 1 for degraded labels', () => {
  assert.equal(rankOf('unlinked'), 1);
});

test('returns 1 for undetermined labels', () => {
  assert.equal(rankOf('unverifiable'), 1);
});

test('returns 1 for damaged labels', () => {
  assert.equal(rankOf('torn'), 1);
});

test('returns 3 for suspect labels', () => {
  assert.equal(rankOf('extended'), 3);
});

test('returns 3 for forged labels', () => {
  assert.equal(rankOf('truncated'), 3);
});

test('returns 1 for unknown labels', () => {
  assert.equal(rankOf('nonexistent-label'), 1);
});

test('returns 1 for empty string label', () => {
  assert.equal(rankOf(''), 1);
});
