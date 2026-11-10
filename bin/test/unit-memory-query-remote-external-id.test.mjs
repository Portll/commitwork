// Resolves a memory's external identifier from nested fields (bin/memory-query.mjs remoteExternalId).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteExternalId } from '../memory-query.mjs';

test('returns null when the input is null', () => {
  const r = remoteExternalId(null);
  assert.equal(r, null);
});

test('returns null when the input is a string', () => {
  const r = remoteExternalId('abc');
  assert.equal(r, null);
});

test('returns null when the input is an empty object', () => {
  const r = remoteExternalId({});
  assert.equal(r, null);
});

test('returns the external_id when it is a non-empty string', () => {
  const r = remoteExternalId({ external_id: 'ext-1' });
  assert.equal(r, "ext-1");
});

test('returns null when external_id is an empty string', () => {
  const r = remoteExternalId({ external_id: '' });
  assert.equal(r, null);
});

test('returns the experience external_id when top-level is missing', () => {
  const r = remoteExternalId({ experience: { external_id: 'exp-1' } });
  assert.equal(r, "exp-1");
});

test('returns the metadata external_id when others are missing', () => {
  const r = remoteExternalId({ metadata: { external_id: 'meta-1' } });
  assert.equal(r, "meta-1");
});

test('returns null when external_id is a number', () => {
  const r = remoteExternalId({ external_id: 42 });
  assert.equal(r, null);
});

test('returns null when external_id is an object', () => {
  const r = remoteExternalId({ external_id: { id: 'x' } });
  assert.equal(r, null);
});

test('returns null when external_id is undefined and no fallbacks exist', () => {
  const r = remoteExternalId({ external_id: undefined });
  assert.equal(r, null);
});
