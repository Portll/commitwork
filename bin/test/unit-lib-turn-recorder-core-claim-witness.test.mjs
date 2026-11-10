// Detects claim words in turn text and whether tool activity witnessed them (bin/lib/turn-recorder-core.mjs claimWitness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimWitness } from '../lib/turn-recorder-core.mjs';

test('returns unclaimed shape when text has no claim words', () => {
  const r = claimWitness({ text: 'hello world' });
  assert.deepEqual(r, { claimed: false, witnessed: null, words: [] });
});

test('returns unclaimed shape when text is null', () => {
  const r = claimWitness({ text: null });
  assert.deepEqual(r, { claimed: false, witnessed: null, words: [] });
});

test('returns unclaimed shape when turn is undefined', () => {
  const r = claimWitness(undefined);
  assert.deepEqual(r, { claimed: false, witnessed: null, words: [] });
});

test('returns unclaimed shape when text is empty string', () => {
  const r = claimWitness({ text: '' });
  assert.deepEqual(r, { claimed: false, witnessed: null, words: [] });
});

test('returns claimed with witnessed true when toolCallCount is positive', () => {
  const r = claimWitness({ text: 'I verified the fix', toolCallCount: 1, toolResults: 0 });
  assert.deepEqual(r, { claimed: true, witnessed: true, words: ["\\bverified\\b"] });
});

test('returns claimed with witnessed true when toolResults is positive', () => {
  const r = claimWitness({ text: 'I confirmed it works', toolCallCount: 0, toolResults: 1 });
  assert.deepEqual(r, { claimed: true, witnessed: true, words: ["\\bconfirmed\\b"] });
});

test('returns claimed with witnessed false when both counts are zero', () => {
  const r = claimWitness({ text: 'I committed the change', toolCallCount: 0, toolResults: 0 });
  assert.deepEqual(r, { claimed: true, witnessed: false, words: ["\\bcommitted\\b"] });
});

test('returns claimed with witnessed false when counts are missing', () => {
  const r = claimWitness({ text: 'I landed the PR' });
  assert.deepEqual(r, { claimed: true, witnessed: false, words: ["\\blanded\\b"] });
});

test('returns claimed with witnessed true when toolCallCount is one', () => {
  const r = claimWitness({ text: 'I re-ran the suite', toolCallCount: 1, toolResults: 0 });
  assert.deepEqual(r, { claimed: true, witnessed: true, words: ["\\bre-?ran\\b"] });
});

test('returns claimed with witnessed true when toolResults is one', () => {
  const r = claimWitness({ text: 'All tests pass', toolCallCount: 0, toolResults: 1 });
  assert.deepEqual(r, { claimed: true, witnessed: true, words: ["\\ball tests? pass(?:es|ed|ing)?\\b"] });
});
