// Maps a truth label to its stratum name or null (bin/adjudication-sampler.mjs stratumOfTruth).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stratumOfTruth } from '../adjudication-sampler.mjs';

test('returns clean for true-clean', () => {
  assert.equal(stratumOfTruth('true-clean'), 'clean');
});

test('returns clean for false-clean', () => {
  assert.equal(stratumOfTruth('false-clean'), 'clean');
});

test('returns alarm for true-alarm', () => {
  assert.equal(stratumOfTruth('true-alarm'), 'alarm');
});

test('returns alarm for false-alarm', () => {
  assert.equal(stratumOfTruth('false-alarm'), 'alarm');
});

test('returns null for unknown truth value', () => {
  assert.equal(stratumOfTruth('unknown'), null);
});

test('returns null for empty string', () => {
  assert.equal(stratumOfTruth(''), null);
});

test('returns null for null input', () => {
  assert.equal(stratumOfTruth(null), null);
});

test('returns null for undefined input', () => {
  assert.equal(stratumOfTruth(undefined), null);
});

test('returns null for numeric input', () => {
  assert.equal(stratumOfTruth(42), null);
});

test('returns null for boolean input', () => {
  assert.equal(stratumOfTruth(true), null);
});
