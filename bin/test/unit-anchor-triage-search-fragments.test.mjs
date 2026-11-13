// Splits text on HOME_PLACEHOLDER, trims, filters short fragments, sorts by length desc then locale (bin/anchor-triage.mjs searchFragments).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchFragments } from '../anchor-triage.mjs';
import { HOME_PLACEHOLDER } from '../anchor-staleness.mjs';

test('returns empty array for null input', () => {
  const input = null;
  const result = searchFragments(input);
  assert.deepEqual(result, []);
});

test('returns empty array for undefined input', () => {
  const input = undefined;
  const result = searchFragments(input);
  assert.deepEqual(result, []);
});

test('returns empty array for empty string', () => {
  const input = '';
  const result = searchFragments(input);
  assert.deepEqual(result, []);
});

test('filters out fragments shorter than 12 characters', () => {
  const input = 'short';
  const result = searchFragments(input);
  assert.deepEqual(result, []);
});

test('keeps fragment of exactly 12 characters', () => {
  const input = 'a'.repeat(12);
  const result = searchFragments(input);
  assert.deepEqual(result, ["aaaaaaaaaaaa"]);
});

test('keeps fragment of 13 characters', () => {
  const input = 'a'.repeat(13);
  const result = searchFragments(input);
  assert.deepEqual(result, ["aaaaaaaaaaaaa"]);
});

test('splits on HOME_PLACEHOLDER trims and filters short segments', () => {
  const input = '  abcdefghijkl  ' + HOME_PLACEHOLDER + '  abcdefghijklm  ';
  const result = searchFragments(input);
  assert.deepEqual(result, ["abcdefghijklm", "abcdefghijkl"]);
});

test('sorts longer fragments before shorter ones', () => {
  const input = 'a'.repeat(12) + HOME_PLACEHOLDER + 'b'.repeat(20);
  const result = searchFragments(input);
  assert.deepEqual(result, ["bbbbbbbbbbbbbbbbbbbb", "aaaaaaaaaaaa"]);
});

test('sorts equal-length fragments by locale order', () => {
  const input = 'zzzzzzzzzzzz' + HOME_PLACEHOLDER + 'aaaaaaaaaaaa';
  const result = searchFragments(input);
  assert.deepEqual(result, ["aaaaaaaaaaaa", "zzzzzzzzzzzz"]);
});

test('handles multiple fragments with mixed lengths and locale ties', () => {
  const input = 'a'.repeat(15) + HOME_PLACEHOLDER + 'b'.repeat(12) + HOME_PLACEHOLDER + 'c'.repeat(15);
  const result = searchFragments(input);
  assert.deepEqual(result, ["aaaaaaaaaaaaaaa", "ccccccccccccccc", "bbbbbbbbbbbb"]);
});
