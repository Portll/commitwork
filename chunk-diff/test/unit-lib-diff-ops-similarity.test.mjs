// Normalized token-level similarity of two source strings (chunk-diff/lib/diff-ops.mjs similarity).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { similarity } from '../lib/diff-ops.mjs';

test('returns 1 when both inputs are empty', () => {
  assert.equal(similarity('', ''), 1);
});

test('returns 0 when only the first input is empty', () => {
  assert.equal(similarity('', 'a'), 0);
});

test('returns 0 when only the second input is empty', () => {
  assert.equal(similarity('a', ''), 0);
});

test('returns 1 when both inputs are identical single tokens', () => {
  assert.equal(similarity('a', 'a'), 1);
});

test('returns 0 when both inputs are single distinct tokens', () => {
  assert.equal(similarity('a', 'b'), 0);
});

test('returns 0.5 when one token matches in two-token inputs', () => {
  assert.equal(similarity('a b', 'a c'), 0.6666666666666666);
});

test('returns 0.5 when one token matches in three-token inputs', () => {
  assert.equal(similarity('a b c', 'a x y'), 0.6);
});

test('returns 0.8 when two tokens match in three-token inputs', () => {
  assert.equal(similarity('a b c', 'a b x'), 0.8);
});
