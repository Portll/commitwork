// Which bucket a judged finding lands in (bin/disclosure-review.mjs bucketOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketOf } from '../disclosure-review.mjs';

test('returns undetermined when judged has an error', () => {
  const input = { error: 'boom', verdict: 'true-positive' };
  const result = bucketOf(input);
  assert.equal(result, "undetermined");
});

test('returns confirmed when verdict is true-positive', () => {
  const input = { verdict: 'true-positive' };
  const result = bucketOf(input);
  assert.equal(result, "confirmed");
});

test('returns dismissed when verdict is false-positive and dismissal is supported', () => {
  const input = { verdict: 'false-positive', dismissalSupported: true };
  const result = bucketOf(input);
  assert.equal(result, "dismissed");
});

test('returns dismissed when verdict is unreachable and dismissal is supported', () => {
  const input = { verdict: 'unreachable', dismissalSupported: true };
  const result = bucketOf(input);
  assert.equal(result, "dismissed");
});

test('returns undetermined when verdict is false-positive but dismissal is not supported', () => {
  const input = { verdict: 'false-positive', dismissalSupported: false };
  const result = bucketOf(input);
  assert.equal(result, "undetermined");
});

test('returns undetermined when verdict is unreachable but dismissal is not supported', () => {
  const input = { verdict: 'unreachable', dismissalSupported: false };
  const result = bucketOf(input);
  assert.equal(result, "undetermined");
});

test('returns undetermined when verdict is neither true-positive nor dismissible', () => {
  const input = { verdict: 'maybe' };
  const result = bucketOf(input);
  assert.equal(result, "undetermined");
});
