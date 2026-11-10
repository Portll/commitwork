// checks whether a string matches the CWX minted format (monitor/cwx-registry.mjs isCwx).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCwx } from '../cwx-registry.mjs';

test('returns true for a valid CWX id', () => {
  const r = isCwx('CWX-ABC123');
  assert.equal(r, true);
});

test('returns false for a lowercase CWX id', () => {
  const r = isCwx('CWX-abc123');
  assert.equal(r, false);
});

test('returns false for a non-string number', () => {
  const r = isCwx(123);
  assert.equal(r, false);
});

test('returns false for a non-string null', () => {
  const r = isCwx(null);
  assert.equal(r, false);
});

test('returns false for a non-string undefined', () => {
  const r = isCwx(undefined);
  assert.equal(r, false);
});

test('returns false for a string that is not a CWX id', () => {
  const r = isCwx('hello');
  assert.equal(r, false);
});

test('returns false for a CWX id with wrong prefix case', () => {
  const r = isCwx('cwx-ABC123');
  assert.equal(r, false);
});

test('returns false for a CWX id with too few body chars', () => {
  const r = isCwx('CWX-ABC12');
  assert.equal(r, false);
});

test('returns false for a CWX id with too many body chars', () => {
  const r = isCwx('CWX-ABC1234');
  assert.equal(r, false);
});

test('returns false for an empty string', () => {
  const r = isCwx('');
  assert.equal(r, false);
});
