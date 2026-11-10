// Maps a sweep status code to a human-readable outcome label (monitor/sweep-verdict.mjs rollupOutcome).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollupOutcome } from '../sweep-verdict.mjs';

test('returns published for null status', () => {
  assert.equal(rollupOutcome(null), "published");
});

test('returns published for undefined status', () => {
  assert.equal(rollupOutcome(undefined), "published");
});

test('returns published for zero status', () => {
  assert.equal(rollupOutcome(0), "published");
});

test('returns refused-empty for status two', () => {
  assert.equal(rollupOutcome(2), "refused-empty");
});

test('returns lock-contention for status three', () => {
  assert.equal(rollupOutcome(3), "lock-contention");
});

test('returns nothing-to-roll-up for status four', () => {
  assert.equal(rollupOutcome(4), "nothing-to-roll-up");
});

test('returns failed prefix for status one', () => {
  assert.equal(rollupOutcome(1), "failed:1");
});

test('returns failed prefix for status five', () => {
  assert.equal(rollupOutcome(5), "failed:5");
});
