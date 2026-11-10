// Maximum edit distance for a package name (monitor/lookalike.mjs maxDistanceFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maxDistanceFor } from '../lookalike.mjs';

test('returns 1 for a name of length 4', () => {
  const r = maxDistanceFor('abcd');
  assert.equal(r, 1);
});

test('returns 1 for a name of length 5', () => {
  const r = maxDistanceFor('abcde');
  assert.equal(r, 1);
});

test('returns 1 for a name of length 10', () => {
  const r = maxDistanceFor('abcdefghij');
  assert.equal(r, 1);
});

test('returns 1 for a name of length 9', () => {
  const r = maxDistanceFor('abcdefghi');
  assert.equal(r, 1);
});

test('returns 2 for a name of length 11', () => {
  const r = maxDistanceFor('abcdefghijk');
  assert.equal(r, 2);
});

test('returns 1 for a scoped name with a 4 character local part', () => {
  const r = maxDistanceFor('@scope/abcd');
  assert.equal(r, 1);
});

test('returns 1 for a scoped name with a 10 character local part', () => {
  const r = maxDistanceFor('@scope/abcdefghij');
  assert.equal(r, 1);
});

test('returns 2 for a scoped name with an 11 character local part', () => {
  const r = maxDistanceFor('@scope/abcdefghijk');
  assert.equal(r, 2);
});
