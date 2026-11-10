// checks if the response body contains the planted canary string (bin/lib/probe-oracle.mjs responseContainsCanary).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { responseContainsCanary } from '../lib/probe-oracle.mjs';

test('returns false when canary is empty string', () => {
  const r = responseContainsCanary({ text: 'hello' }, '');
  assert.equal(r, false);
});

test('returns false when canary is null', () => {
  const r = responseContainsCanary({ text: 'hello' }, null);
  assert.equal(r, false);
});

test('returns true when text field contains the canary', () => {
  const r = responseContainsCanary({ text: 'prefix CANARY_123 suffix' }, 'CANARY_123');
  assert.equal(r, true);
});

test('returns false when text field does not contain the canary', () => {
  const r = responseContainsCanary({ text: 'no marker here' }, 'CANARY_123');
  assert.equal(r, false);
});

test('returns true when body field contains the canary and text is not a string', () => {
  const r = responseContainsCanary({ text: 42, body: 'x CANARY_123 y' }, 'CANARY_123');
  assert.equal(r, true);
});

test('returns false when body field does not contain the canary and text is not a string', () => {
  const r = responseContainsCanary({ text: 42, body: 'plain text' }, 'CANARY_123');
  assert.equal(r, false);
});

test('returns false when resp is null and canary is provided', () => {
  const r = responseContainsCanary(null, 'CANARY_123');
  assert.equal(r, false);
});

test('returns false when resp is undefined and canary is provided', () => {
  const r = responseContainsCanary(undefined, 'CANARY_123');
  assert.equal(r, false);
});
