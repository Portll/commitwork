// Compares two version strings numerically and lexicographically (monitor/update-vulns.mjs cmpVersion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cmpVersion } from '../update-vulns.mjs';

test('returns 0 when both version strings are identical', () => {
  assert.equal(cmpVersion('1.2.3', '1.2.3'), 0);
});

test('returns -1 when the first numeric segment is smaller', () => {
  assert.equal(cmpVersion('1.0.0', '2.0.0'), -1);
});

test('returns 1 when the first numeric segment is larger', () => {
  assert.equal(cmpVersion('2.0.0', '1.0.0'), 1);
});

test('returns 0 when one version is a prefix of the other with trailing zeros', () => {
  assert.equal(cmpVersion('1.2', '1.2.0'), 0);
});

test('returns -1 when the shorter version is a prefix of the longer one', () => {
  assert.equal(cmpVersion('1.2', '1.2.1'), -1);
});

test('returns 1 when the longer version has a non-zero trailing segment', () => {
  assert.equal(cmpVersion('1.2.1', '1.2'), 1);
});

test('returns -1 when comparing non-numeric segments lexicographically', () => {
  assert.equal(cmpVersion('1.0-alpha', '1.0-beta'), -1);
});

test('returns 1 when comparing non-numeric segments lexicographically in reverse', () => {
  assert.equal(cmpVersion('1.0-beta', '1.0-alpha'), 1);
});

test('returns -1 when numeric segment is smaller than non-numeric segment', () => {
  assert.equal(cmpVersion('1.0.1', '1.0-alpha'), -1);
});

test('returns 1 when non-numeric segment is smaller than numeric segment', () => {
  assert.equal(cmpVersion('1.0-alpha', '1.0.1'), 1);
});
