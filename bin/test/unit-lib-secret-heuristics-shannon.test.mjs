// Shannon entropy of a string (bin/lib/secret-heuristics.mjs shannon).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shannon } from '../lib/secret-heuristics.mjs';

test('returns 0 for an empty string', () => {
  assert.equal(shannon(''), 0);
});

test('returns 0 for a string of identical characters', () => {
  assert.equal(shannon('aaaa'), 0);
});

test('returns 1 for a string of two distinct characters each appearing once', () => {
  assert.equal(shannon('ab'), 1);
});

test('returns 2 for a string of four distinct characters each appearing once', () => {
  assert.equal(shannon('abcd'), 2);
});

test('returns 1 for a string of two distinct characters each appearing twice', () => {
  assert.equal(shannon('aabb'), 1);
});

test('returns 1.5 for a string with three characters where one appears twice and two appear once', () => {
  const expected = 0.5 * Math.log2(0.5) * -1 + 0.25 * Math.log2(0.25) * -1 + 0.25 * Math.log2(0.25) * -1;
  assert.equal(shannon('aabc'), expected);
});

test('returns the entropy of a string of two characters split three to one', () => {
  const expected = 0.75 * Math.log2(0.75) * -1 + 0.25 * Math.log2(0.25) * -1;
  assert.equal(shannon('aaab'), expected);
});

test('returns 0 for a single character string', () => {
  assert.equal(shannon('a'), 0);
});
