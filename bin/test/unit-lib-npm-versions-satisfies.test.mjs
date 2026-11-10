// Determines whether a version string matches an npm-style range (bin/lib/npm-versions.mjs satisfies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { satisfies } from '../lib/npm-versions.mjs';

test('returns null when the version is not parseable', () => {
  assert.equal(satisfies('not-a-version', '1.0.0'), null);
});

test('returns true for a caret range when the version is within bounds', () => {
  assert.equal(satisfies('1.2.3', '^1.2.0'), true);
});

test('returns false for a caret range when the version exceeds the upper bound', () => {
  assert.equal(satisfies('2.0.0', '^1.2.0'), false);
});

test('returns true for a tilde range when the version is within bounds', () => {
  assert.equal(satisfies('1.2.3', '~1.2.0'), true);
});

test('returns false for a tilde range when the minor version is higher', () => {
  assert.equal(satisfies('1.3.0', '~1.2.0'), false);
});

test('returns true for a hyphen range when the version is within bounds', () => {
  assert.equal(satisfies('1.2.3', '1.2.0 - 1.2.5'), true);
});

test('returns false for a hyphen range when the version exceeds the upper bound', () => {
  assert.equal(satisfies('1.2.6', '1.2.0 - 1.2.5'), false);
});

test('returns true for an exact match with equals operator', () => {
  assert.equal(satisfies('1.2.3', '=1.2.3'), true);
});

test('returns false for an exact match when versions differ', () => {
  assert.equal(satisfies('1.2.4', '=1.2.3'), false);
});

test('returns true for a less-than operator when version is below bound', () => {
  assert.equal(satisfies('1.2.2', '<1.2.3'), true);
});

test('returns false for a less-than operator when version equals bound', () => {
  assert.equal(satisfies('1.2.3', '<1.2.3'), false);
});

test('returns true for a greater-than-or-equal operator when version equals bound', () => {
  assert.equal(satisfies('1.2.3', '>=1.2.3'), true);
});

test('returns false for a greater-than-or-equal operator when version is below bound', () => {
  assert.equal(satisfies('1.2.2', '>=1.2.3'), false);
});

test('returns true for a less-than-or-equal operator when version equals bound', () => {
  assert.equal(satisfies('1.2.3', '<=1.2.3'), true);
});

test('returns false for a less-than-or-equal operator when version exceeds bound', () => {
  assert.equal(satisfies('1.2.4', '<=1.2.3'), false);
});

test('returns true for a greater-than operator when version exceeds bound', () => {
  assert.equal(satisfies('1.2.4', '>1.2.3'), true);
});

test('returns false for a greater-than operator when version equals bound', () => {
  assert.equal(satisfies('1.2.3', '>1.2.3'), false);
});

test('returns true when any alternative in an OR range matches', () => {
  assert.equal(satisfies('2.0.0', '1.0.0 || 2.0.0'), true);
});

test('returns false when no alternative in an OR range matches', () => {
  assert.equal(satisfies('3.0.0', '1.0.0 || 2.0.0'), false);
});

test('returns true for a wildcard range matching any version', () => {
  assert.equal(satisfies('1.2.3', '*'), true);
});

test('returns true for a partial range with x matching any minor and patch', () => {
  assert.equal(satisfies('1.9.9', '1.x'), true);
});

test('returns false for a partial range with x when major does not match', () => {
  assert.equal(satisfies('2.0.0', '1.x'), false);
});

test('returns true for a pre-release version matching a range with pre-release', () => {
  assert.equal(satisfies('1.2.3-alpha', '1.2.3-alpha'), true);
});

test('returns false for a pre-release version not matching the exact pre-release', () => {
  assert.equal(satisfies('1.2.3-beta', '1.2.3-alpha'), false);
});

test('returns true for a range with multiple space-separated comparators', () => {
  assert.equal(satisfies('1.2.3', '>=1.2.0 <=1.2.5'), true);
});

test('returns false for a range with multiple comparators when one fails', () => {
  assert.equal(satisfies('1.2.6', '>=1.2.0 <=1.2.5'), false);
});

test('returns true for a zero-major caret range within bounds', () => {
  assert.equal(satisfies('0.2.3', '^0.2.0'), true);
});

test('returns false for a zero-major caret range when minor exceeds bound', () => {
  assert.equal(satisfies('0.3.0', '^0.2.0'), false);
});

test('returns true for a zero-zero caret range matching exact patch', () => {
  assert.equal(satisfies('0.0.3', '^0.0.3'), true);
});

test('returns false for a zero-zero caret range when patch differs', () => {
  assert.equal(satisfies('0.0.4', '^0.0.3'), false);
});
