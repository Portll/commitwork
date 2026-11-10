// Formats a refutation target address as kind:id (monitor/refutation.mjs targetAddress).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetAddress } from '../refutation.mjs';

test('returns the address for a valid closure kind', () => {
  const r = targetAddress({ kind: 'closure', id: 'abc' });
  assert.equal(r, "closure:abc");
});

test('returns the address for a valid classification kind', () => {
  const r = targetAddress({ kind: 'classification', id: 'xyz' });
  assert.equal(r, "classification:xyz");
});

test('returns the address for a valid band kind', () => {
  const r = targetAddress({ kind: 'band', id: '123' });
  assert.equal(r, "band:123");
});

test('returns the address for a valid detector kind', () => {
  const r = targetAddress({ kind: 'detector', id: 'det-1' });
  assert.equal(r, "detector:det-1");
});

test('throws for an invalid kind', () => {
  assert.throws(
    () => targetAddress({ kind: 'invalid', id: 'abc' }),
    { name: 'Error', message: 'target kind must be one of closure|classification|band|detector' }
  );
});

test('throws when id is empty string', () => {
  assert.throws(
    () => targetAddress({ kind: 'closure', id: '' }),
    { name: 'Error', message: 'a closure refutation needs a target id' }
  );
});

test('throws when id is null', () => {
  assert.throws(
    () => targetAddress({ kind: 'closure', id: null }),
    { name: 'Error', message: 'a closure refutation needs a target id' }
  );
});

test('throws when id is undefined', () => {
  assert.throws(
    () => targetAddress({ kind: 'closure', id: undefined }),
    { name: 'Error', message: 'a closure refutation needs a target id' }
  );
});

test('trims whitespace from id before formatting', () => {
  const r = targetAddress({ kind: 'closure', id: '  abc  ' });
  assert.equal(r, "closure:abc");
});

test('handles id with only whitespace characters', () => {
  assert.throws(
    () => targetAddress({ kind: 'closure', id: '   ' }),
    { name: 'Error', message: 'a closure refutation needs a target id' }
  );
});
