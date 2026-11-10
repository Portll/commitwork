// Sums nullable token fields across a list of turn records (bin/lib/turn-recorder-core.mjs sumTokens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumTokens } from '../lib/turn-recorder-core.mjs';

test('returns all-null object for an empty list', () => {
  assert.deepEqual(sumTokens([]), { input: null, output: null, cacheRead: null, cacheCreation: null, thinking: null });
});

test('sums a single record with all fields present', () => {
  const rec = { input: 1, output: 2, cacheRead: 3, cacheCreation: 4, thinking: 5 };
  assert.deepEqual(sumTokens([rec]), { input: 1, output: 2, cacheRead: 3, cacheCreation: 4, thinking: 5 });
});

test('treats missing fields as zero when the other side is present', () => {
  const rec = { input: 10 };
  assert.deepEqual(sumTokens([rec]), { input: 10, output: 0, cacheRead: 0, cacheCreation: 0, thinking: 0 });
});

test('keeps null when both accumulated and record values are null', () => {
  const rec = { input: null, output: null, cacheRead: null, cacheCreation: null, thinking: null };
  assert.deepEqual(sumTokens([rec]), { input: null, output: null, cacheRead: null, cacheCreation: null, thinking: null });
});

test('skips falsy entries in the list', () => {
  const rec = { input: 1, output: 2, cacheRead: 3, cacheCreation: 4, thinking: 5 };
  assert.deepEqual(sumTokens([null, undefined, 0, '', rec]), { input: 1, output: 2, cacheRead: 3, cacheCreation: 4, thinking: 5 });
});

test('sums multiple records across all fields', () => {
  const a = { input: 1, output: 1, cacheRead: 1, cacheCreation: 1, thinking: 1 };
  const b = { input: 2, output: 2, cacheRead: 2, cacheCreation: 2, thinking: 2 };
  assert.deepEqual(sumTokens([a, b]), { input: 3, output: 3, cacheRead: 3, cacheCreation: 3, thinking: 3 });
});

test('treats undefined fields as zero via nullish coalescing', () => {
  const rec = { input: 7, output: undefined, cacheRead: undefined, cacheCreation: undefined, thinking: undefined };
  assert.deepEqual(sumTokens([rec]), { input: 7, output: 0, cacheRead: 0, cacheCreation: 0, thinking: 0 });
});

test('handles zero-valued fields without changing the sum', () => {
  const rec = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, thinking: 0 };
  assert.deepEqual(sumTokens([rec]), { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, thinking: 0 });
});
