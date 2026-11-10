// Classifies a path as unlinked, sleight, spine, or other (admin/lib/spine-preconditions.mjs linkHome).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkHome } from '../lib/spine-preconditions.mjs';

test('returns unlinked when target is empty string', () => {
  assert.equal(linkHome(''), 'unlinked');
});

test('returns unlinked when target is null', () => {
  assert.equal(linkHome(null), 'unlinked');
});

test('returns unlinked when target is undefined', () => {
  assert.equal(linkHome(undefined), 'unlinked');
});

test('returns sleight when path contains sleight as directory', () => {
  assert.equal(linkHome('/home/user/sleight/file.txt'), 'sleight');
});

test('returns sleight when path ends with sleight', () => {
  assert.equal(linkHome('/home/user/sleight'), 'sleight');
});

test('returns sleight when path contains sleight with backslash', () => {
  assert.equal(linkHome('C:\\Users\\user\\sleight\\file.txt'), 'sleight');
});

test('returns spine when path contains substrate as directory', () => {
  assert.equal(linkHome('/home/user/substrate/file.txt'), 'spine');
});

test('returns spine when path contains spine as directory', () => {
  assert.equal(linkHome('/home/user/spine/file.txt'), 'spine');
});

test('returns spine when path ends with substrate', () => {
  assert.equal(linkHome('/home/user/substrate'), 'spine');
});

test('returns spine when path ends with spine', () => {
  assert.equal(linkHome('/home/user/spine'), 'spine');
});

test('returns other for path with no special directories', () => {
  assert.equal(linkHome('/home/user/documents/file.txt'), 'other');
});

test('returns other for path with similar but non-matching names', () => {
  assert.equal(linkHome('/home/user/sleightful/file.txt'), 'other');
});

test('returns other for path with similar but non-matching spine names', () => {
  assert.equal(linkHome('/home/user/spinal/file.txt'), 'other');
});
