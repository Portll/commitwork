// bin/test/store-paths-units.test.mjs — case tests for treeClaim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { treeClaim } from '../lib/store-paths.mjs';

test('returns "unknown" when rec is null', () => {
  assert.equal(treeClaim(null, 'abc'), 'unknown');
});

test('returns "unknown" when rec is undefined', () => {
  assert.equal(treeClaim(undefined, 'abc'), 'unknown');
});

test('returns "unknown" when rec has no r property', () => {
  assert.equal(treeClaim({}, 'abc'), 'unknown');
});

test('returns "unknown" when rec.r is empty string', () => {
  assert.equal(treeClaim({ r: '' }, 'abc'), 'unknown');
});

test('returns "unknown" when rec.r is not a string', () => {
  assert.equal(treeClaim({ r: 123 }, 'abc'), 'unknown');
});

test('returns "mine" when rec.r equals self', () => {
  assert.equal(treeClaim({ r: 'abc' }, 'abc'), 'mine');
});

test('returns "other" when rec.r differs from self', () => {
  assert.equal(treeClaim({ r: 'xyz' }, 'abc'), 'other');
});

test('returns "other" when rec.r is a different non-empty string', () => {
  assert.equal(treeClaim({ r: 'def' }, 'abc'), 'other');
});
