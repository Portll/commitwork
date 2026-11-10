// Matches a field value against a condition object (bin/wp-posture.mjs fieldMatches).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldMatches } from '../wp-posture.mjs';

test('returns true when value equals a primitive condition', () => {
  const result = fieldMatches(5, 5);
  assert.equal(result, true);
});

test('returns false when value differs from a primitive condition', () => {
  const result = fieldMatches(5, 6);
  assert.equal(result, false);
});

test('returns true when value is in the array condition', () => {
  const result = fieldMatches(2, [1, 2, 3]);
  assert.equal(result, true);
});

test('returns false when value is not in the array condition', () => {
  const result = fieldMatches(4, [1, 2, 3]);
  assert.equal(result, false);
});

test('returns true when value is not equal to the neq argument', () => {
  const result = fieldMatches(1, { neq: 2 });
  assert.equal(result, true);
});

test('returns false when value equals the neq argument', () => {
  const result = fieldMatches(2, { neq: 2 });
  assert.equal(result, false);
});

test('returns true when value is not in the notIn array', () => {
  const result = fieldMatches(4, { notIn: [1, 2, 3] });
  assert.equal(result, true);
});

test('returns false when value is in the notIn array', () => {
  const result = fieldMatches(2, { notIn: [1, 2, 3] });
  assert.equal(result, false);
});

test('returns true when numeric value is greater than the gt argument', () => {
  const result = fieldMatches(10, { gt: 5 });
  assert.equal(result, true);
});

test('returns false when numeric value equals the gt argument', () => {
  const result = fieldMatches(5, { gt: 5 });
  assert.equal(result, false);
});

test('returns true when numeric value is greater than or equal to the gte argument', () => {
  const result = fieldMatches(5, { gte: 5 });
  assert.equal(result, true);
});

test('returns false when numeric value is less than the gte argument', () => {
  const result = fieldMatches(4, { gte: 5 });
  assert.equal(result, false);
});

test('returns true when numeric value is less than the lt argument', () => {
  const result = fieldMatches(4, { lt: 5 });
  assert.equal(result, true);
});

test('returns false when numeric value equals the lt argument', () => {
  const result = fieldMatches(5, { lt: 5 });
  assert.equal(result, false);
});

test('returns true when numeric value is less than or equal to the lte argument', () => {
  const result = fieldMatches(5, { lte: 5 });
  assert.equal(result, true);
});

test('returns false when numeric value is greater than the lte argument', () => {
  const result = fieldMatches(6, { lte: 5 });
  assert.equal(result, false);
});

test('returns true when string value contains the substring', () => {
  const result = fieldMatches('hello world', { contains: 'world' });
  assert.equal(result, true);
});

test('returns false when string value does not contain the substring', () => {
  const result = fieldMatches('hello', { contains: 'world' });
  assert.equal(result, false);
});

test('returns true when string value does not contain the substring for notContains', () => {
  const result = fieldMatches('hello', { notContains: 'world' });
  assert.equal(result, true);
});

test('returns false when string value contains the substring for notContains', () => {
  const result = fieldMatches('hello world', { notContains: 'world' });
  assert.equal(result, false);
});

test('returns true when string starts with the prefix', () => {
  const result = fieldMatches('hello', { startsWith: 'he' });
  assert.equal(result, true);
});

test('returns false when string does not start with the prefix', () => {
  const result = fieldMatches('world', { startsWith: 'he' });
  assert.equal(result, false);
});

test('returns true when string ends with the suffix', () => {
  const result = fieldMatches('hello', { endsWith: 'lo' });
  assert.equal(result, true);
});

test('returns false when string does not end with the suffix', () => {
  const result = fieldMatches('world', { endsWith: 'lo' });
  assert.equal(result, false);
});

test('returns true when value is defined and exists is true', () => {
  const result = fieldMatches('value', { exists: true });
  assert.equal(result, true);
});

test('returns false when value is null and exists is true', () => {
  const result = fieldMatches(null, { exists: true });
  assert.equal(result, false);
});

test('returns true when value is null and exists is false', () => {
  const result = fieldMatches(null, { exists: false });
  assert.equal(result, true);
});

test('returns false when value is defined and exists is false', () => {
  const result = fieldMatches('value', { exists: false });
  assert.equal(result, false);
});

test('throws an error for an unknown operator', () => {
  assert.throws(() => fieldMatches(1, { unknown: 2 }), { name: 'Error', message: "unknown operator 'unknown'" });
});
