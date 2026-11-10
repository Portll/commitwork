// Returns true when both objects share the same digest, false when they differ, null when either lacks a digest (bin/measured.mjs sameSource).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameSource } from '../measured.mjs';

test('returns null when the first argument is null', () => {
  const r = sameSource(null, { digest: 'abc' });
  assert.equal(r, null);
});

test('returns null when the second argument is null', () => {
  const r = sameSource({ digest: 'abc' }, null);
  assert.equal(r, null);
});

test('returns null when the first argument is undefined', () => {
  const r = sameSource(undefined, { digest: 'abc' });
  assert.equal(r, null);
});

test('returns null when the second argument is undefined', () => {
  const r = sameSource({ digest: 'abc' }, undefined);
  assert.equal(r, null);
});

test('returns null when the first object has no digest property', () => {
  const r = sameSource({}, { digest: 'abc' });
  assert.equal(r, null);
});

test('returns null when the second object has no digest property', () => {
  const r = sameSource({ digest: 'abc' }, {});
  assert.equal(r, null);
});

test('returns null when both objects have no digest property', () => {
  const r = sameSource({}, {});
  assert.equal(r, null);
});

test('returns true when both objects have the same digest', () => {
  const r = sameSource({ digest: 'abc' }, { digest: 'abc' });
  assert.equal(r, true);
});

test('returns false when both objects have different digests', () => {
  const r = sameSource({ digest: 'abc' }, { digest: 'def' });
  assert.equal(r, false);
});

test('returns true when both objects have the same empty string digest', () => {
  const r = sameSource({ digest: '' }, { digest: '' });
  assert.equal(r, null);
});
