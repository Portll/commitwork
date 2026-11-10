// Compares two version strings by canonicalized part order (bin/lib/wordpress.mjs versionCompare).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionCompare } from '../lib/wordpress.mjs';

test('returns zero when both inputs are identical', () => {
  assert.equal(versionCompare('1.2.3', '1.2.3'), 0);
});

test('returns negative when the first version is lower', () => {
  assert.equal(versionCompare('1.0.0', '1.1.0'), -1);
});

test('returns positive when the first version is higher', () => {
  assert.equal(versionCompare('2.0.0', '1.9.9'), 1);
});

test('returns positive when the first version has extra numeric parts', () => {
  assert.equal(versionCompare('1.0.0.1', '1.0.0'), 1);
});

test('returns negative when the second version has extra numeric parts', () => {
  assert.equal(versionCompare('1.0.0', '1.0.0.1'), -1);
});

test('returns positive when the first version has extra non-numeric parts', () => {
  assert.equal(versionCompare('1.0.0-alpha', '1.0.0'), -1);
});

test('returns negative when the second version has extra non-numeric parts', () => {
  assert.equal(versionCompare('1.0.0', '1.0.0-alpha'), 1);
});

test('returns zero when both versions have equal non-numeric suffixes', () => {
  assert.equal(versionCompare('1.0.0-alpha', '1.0.0-alpha'), 0);
});
