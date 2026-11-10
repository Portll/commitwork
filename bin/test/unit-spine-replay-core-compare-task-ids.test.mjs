// Compares dotted task ids by numeric segments then code units (bin/spine-replay-core.mjs compareTaskIds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareTaskIds } from '../spine-replay-core.mjs';

test('returns zero when both ids are identical', () => {
  assert.equal(compareTaskIds('1.2.3', '1.2.3'), 0);
});

test('returns negative when the first id is a prefix of the second', () => {
  assert.equal(compareTaskIds('1.2', '1.2.3'), -1);
});

test('returns positive when the second id is a prefix of the first', () => {
  assert.equal(compareTaskIds('1.2.3', '1.2'), 1);
});

test('returns the numeric difference when both segments are digits and differ', () => {
  assert.equal(compareTaskIds('1.2', '1.3'), -1);
});

test('returns zero when both segments are equal digits', () => {
  assert.equal(compareTaskIds('1.2', '1.2'), 0);
});

test('returns the code-unit difference when both segments are non-digits and differ', () => {
  assert.equal(compareTaskIds('1.a', '1.b'), -1);
});

test('returns zero when both segments are equal non-digits', () => {
  assert.equal(compareTaskIds('1.a', '1.a'), 0);
});

test('returns the code-unit difference when one segment is a digit and the other is not', () => {
  assert.equal(compareTaskIds('1.2', '1.a'), -1);
});

test('returns the code-unit difference when the first segment is non-digit and the second is a digit', () => {
  assert.equal(compareTaskIds('1.a', '1.2'), 1);
});

test('returns the code-unit difference when the first segment is a digit and the second is non-digit', () => {
  assert.equal(compareTaskIds('1.2', '1.a'), -1);
});
