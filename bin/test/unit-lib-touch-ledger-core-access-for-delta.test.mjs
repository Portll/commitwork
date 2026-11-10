// Maps a corroborated flag to a ledger access level (bin/lib/touch-ledger-core.mjs accessForDelta).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessForDelta } from '../lib/touch-ledger-core.mjs';

test('returns write when corroborated is true', () => {
  const r = accessForDelta({ corroborated: true });
  assert.equal(r, "write");
});

test('returns undetermined when corroborated is false', () => {
  const r = accessForDelta({ corroborated: false });
  assert.equal(r, "undetermined");
});

test('returns undetermined when corroborated is 0', () => {
  const r = accessForDelta({ corroborated: 0 });
  assert.equal(r, "undetermined");
});

test('returns undetermined when corroborated is empty string', () => {
  const r = accessForDelta({ corroborated: '' });
  assert.equal(r, "undetermined");
});

test('returns undetermined when corroborated is null', () => {
  const r = accessForDelta({ corroborated: null });
  assert.equal(r, "undetermined");
});

test('returns undetermined when corroborated is undefined', () => {
  const r = accessForDelta({ corroborated: undefined });
  assert.equal(r, "undetermined");
});

test('returns write when corroborated is 1', () => {
  const r = accessForDelta({ corroborated: 1 });
  assert.equal(r, "write");
});

test('returns write when corroborated is non-empty string', () => {
  const r = accessForDelta({ corroborated: 'yes' });
  assert.equal(r, "write");
});
