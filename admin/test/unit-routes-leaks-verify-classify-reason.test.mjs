// Maps a free-text reason string to a canonical leak-verification class (admin/routes/leaks-verify.mjs classifyReason).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReason } from '../routes/leaks-verify.mjs';

test('returns unrecognised when the reason is not a string', () => {
  assert.equal(classifyReason(null), 'unrecognised');
  assert.equal(classifyReason(undefined), 'unrecognised');
  assert.equal(classifyReason(42), 'unrecognised');
  assert.equal(classifyReason({}), 'unrecognised');
});

test('returns unrecognised for an empty string', () => {
  assert.equal(classifyReason(''), 'unrecognised');
});

test('returns unrecognised for text that matches no pattern', () => {
  assert.equal(classifyReason('the value was wrong'), 'unrecognised');
  assert.equal(classifyReason('totally unrelated text here'), 'unrecognised');
});

test('classifies rolled when the text mentions rotation or replacement', () => {
  assert.equal(classifyReason('the key was rolled'), 'rolled');
  assert.equal(classifyReason('secret rotation completed'), 'rolled');
  assert.equal(classifyReason('credential replaced'), 'rolled');
  assert.equal(classifyReason('token re-issued'), 'rolled');
  assert.equal(classifyReason('new token generated'), 'rolled');
  assert.equal(classifyReason('new key issued'), 'rolled');
  assert.equal(classifyReason('new secret created'), 'rolled');
  assert.equal(classifyReason('new credential added'), 'rolled');
});

test('classifies expired when the text mentions expiry or invalidity', () => {
  assert.equal(classifyReason('token expired'), 'expired');
  assert.equal(classifyReason('certificate expires soon'), 'expired');
  assert.equal(classifyReason('session expiry reached'), 'expired');
  assert.equal(classifyReason('credential expiration'), 'expired');
  assert.equal(classifyReason('no longer valid'), 'expired');
  assert.equal(classifyReason('past its ttl'), 'expired');
});

test('classifies test-fixture when the text mentions fixtures or mocks', () => {
  assert.equal(classifyReason('found in fixtures'), 'test-fixture');
  assert.equal(classifyReason('test file contains secret'), 'test-fixture');
  assert.equal(classifyReason('test data only'), 'test-fixture');
  assert.equal(classifyReason('spec file has key'), 'test-fixture');
  assert.equal(classifyReason('mocked credential'), 'test-fixture');
  assert.equal(classifyReason('dummy value'), 'test-fixture');
  assert.equal(classifyReason('sample data'), 'test-fixture');
  assert.equal(classifyReason('example key'), 'test-fixture');
  assert.equal(classifyReason('placeholder token'), 'test-fixture');
});

test('prioritises rolled over expired when both patterns match', () => {
  assert.equal(classifyReason('expired token was rolled'), 'rolled');
  assert.equal(classifyReason('rotated and expired'), 'rolled');
});

test('prioritises expired over test-fixture when both patterns match', () => {
  assert.equal(classifyReason('expired test fixture'), 'expired');
  assert.equal(classifyReason('no longer valid in test file'), 'expired');
});

test('prioritises rolled over test-fixture when both patterns match', () => {
  assert.equal(classifyReason('replaced test fixture'), 'rolled');
  assert.equal(classifyReason('new key in fixtures'), 'rolled');
});
