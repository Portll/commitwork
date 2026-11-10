// Maps a numeric value to a discrete ladder rank between 1 and length. (monitor/perf-tuning.mjs ladderRank).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ladderRank } from '../perf-tuning.mjs';

test('returns null when length is not an integer', () => {
  const r = ladderRank(3, { from: 1, to: 5, length: 2.5 });
  assert.equal(r, null);
});

test('returns null when length is less than 1', () => {
  const r = ladderRank(3, { from: 1, to: 5, length: 0 });
  assert.equal(r, null);
});

test('returns 1 when length is 1', () => {
  const r = ladderRank(3, { from: 1, to: 5, length: 1 });
  assert.equal(r, 1);
});

test('returns length when to is less than or equal to from', () => {
  const r = ladderRank(3, { from: 5, to: 5, length: 4 });
  assert.equal(r, 4);
});

test('returns 1 when value is below from', () => {
  const r = ladderRank(0, { from: 1, to: 5, length: 5 });
  assert.equal(r, 1);
});

test('returns length when value is above to', () => {
  const r = ladderRank(6, { from: 1, to: 5, length: 5 });
  assert.equal(r, 5);
});

test('returns middle rank when value is between from and to', () => {
  const r = ladderRank(3, { from: 1, to: 5, length: 5 });
  assert.equal(r, 3);
});

test('uses default from and to when not provided', () => {
  const r = ladderRank(3, { length: 5 });
  assert.equal(r, 3);
});
