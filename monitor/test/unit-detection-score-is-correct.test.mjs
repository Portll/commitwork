// Determines if a classification matches the item's collapse mode (monitor/detection-score.mjs isCorrect).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCorrect } from '../detection-score.mjs';

test('returns true for strict mode with false-positive classification', () => {
  const item = { collapseMode: 'strict' };
  assert.equal(isCorrect(item, 'false-positive'), true);
});

test('returns false for strict mode with real classification', () => {
  const item = { collapseMode: 'strict' };
  assert.equal(isCorrect(item, 'real'), false);
});

test('returns false for strict mode with needs-human classification', () => {
  const item = { collapseMode: 'strict' };
  assert.equal(isCorrect(item, 'needs-human'), false);
});

test('returns false for weak mode with real classification', () => {
  const item = { collapseMode: 'weak' };
  assert.equal(isCorrect(item, 'real'), false);
});

test('returns true for weak mode with false-positive classification', () => {
  const item = { collapseMode: 'weak' };
  assert.equal(isCorrect(item, 'false-positive'), true);
});

test('returns true for weak mode with needs-human classification', () => {
  const item = { collapseMode: 'weak' };
  assert.equal(isCorrect(item, 'needs-human'), true);
});

test('returns true for survive mode with real classification', () => {
  const item = { collapseMode: 'survive' };
  assert.equal(isCorrect(item, 'real'), true);
});

test('returns false for survive mode with false-positive classification', () => {
  const item = { collapseMode: 'survive' };
  assert.equal(isCorrect(item, 'false-positive'), false);
});

test('returns true for survive mode with needs-human classification', () => {
  const item = { collapseMode: 'survive' };
  assert.equal(isCorrect(item, 'needs-human'), true);
});

test('returns false for unknown collapse mode', () => {
  const item = { collapseMode: 'unknown' };
  assert.equal(isCorrect(item, 'real'), false);
});
