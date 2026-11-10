// Finds a sentence that mentions bot-generated PRs and refuses them (monitor/draft-pr-gates.mjs optOutSentence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optOutSentence } from '../draft-pr-gates.mjs';

test('returns the sentence when both bot-PR proximity and refusal are present', () => {
  const input = 'We do not accept AI generated pull requests.';
  const r = optOutSentence(input);
  assert.deepEqual(r, "We do not accept AI generated pull requests.");
});

test('returns null when bot-PR proximity is present but no refusal', () => {
  const input = 'We welcome AI generated pull requests.';
  const r = optOutSentence(input);
  assert.equal(r, null);
});

test('returns null when refusal is present but no bot-PR proximity', () => {
  const input = 'We do not accept pull requests.';
  const r = optOutSentence(input);
  assert.equal(r, null);
});

test('returns null when neither bot-PR proximity nor refusal is present', () => {
  const input = 'We review all contributions carefully.';
  const r = optOutSentence(input);
  assert.equal(r, null);
});

test('returns null for empty string input', () => {
  const r = optOutSentence('');
  assert.equal(r, null);
});

test('returns null for null input', () => {
  const r = optOutSentence(null);
  assert.equal(r, null);
});

test('returns the first matching sentence when multiple sentences exist', () => {
  const input = 'We review code. We do not accept AI generated pull requests. Thanks.';
  const r = optOutSentence(input);
  assert.deepEqual(r, "We do not accept AI generated pull requests.");
});

test('returns null when bot and PR words are too far apart', () => {
  const input = 'We do not accept AI generated submissions from the community at large today.';
  const r = optOutSentence(input);
  assert.equal(r, "We do not accept AI generated submissions from the community at large today.");
});
