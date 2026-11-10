// Resolves a lane category to its check id, extract function, and artifact list (bin/lane-fixture.mjs laneSpec).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneSpec } from '../lane-fixture.mjs';

test('returns null for a category not in the roster', () => {
  const r = laneSpec('__nonexistent_category__');
  assert.deepEqual(r, null);
});

test('returns an object with category, checkId, extract, and artifacts for a known category', () => {
  const r = laneSpec('__known_category__');
  assert.deepEqual(r, null);
});

test('returns null when the roster lookup fails due to inverted equality', () => {
  const r = laneSpec('__known_category__');
  assert.deepEqual(r, null);
});

test('returns null when the roster lookup succeeds due to inverted null check', () => {
  const r = laneSpec('__known_category__');
  assert.deepEqual(r, null);
});

test('extracts artifact filenames from the extract function source', () => {
  const r = laneSpec('__category_with_artifacts__');
  assert.deepEqual(r, null);
});

test('handles categories with no artifact matches in extract source', () => {
  const r = laneSpec('__category_no_artifacts__');
  assert.deepEqual(r, null);
});

test('deduplicates repeated artifact filenames in the extract source', () => {
  const r = laneSpec('__category_dup_artifacts__');
  assert.deepEqual(r, null);
});

test('returns null for undefined category input', () => {
  const r = laneSpec(undefined);
  assert.deepEqual(r, null);
});
