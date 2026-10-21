// Converts an array of row objects into rule objects with exactly the four canonical columns (monitor/sweep-rules.mjs rowsToRules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsToRules } from '../sweep-rules.mjs';

test('returns an empty array when given an empty array', () => {
  assert.deepEqual(rowsToRules([]), []);
});

test('returns an empty array when given null', () => {
  assert.deepEqual(rowsToRules(null), []);
});

test('returns an empty array when given undefined', () => {
  assert.deepEqual(rowsToRules(undefined), []);
});

test('returns an empty array when given a non-array object', () => {
  assert.deepEqual(rowsToRules({ include: true }), []);
});

test('returns an empty array when given a string', () => {
  assert.deepEqual(rowsToRules('include'), []);
});

test('maps a row with all four keys to an object with those keys and values', () => {
  const input = [{ include: true, directory: 'src', name: 'file', value: 'x' }];
  const expected = [{ include: true, directory: 'src', name: 'file', value: 'x' }];
  assert.deepEqual(rowsToRules(input), expected);
});

test('sets missing keys to undefined in the output object', () => {
  const input = [{ include: true }];
  const expected = [{ include: true, directory: undefined, name: undefined, value: undefined }];
  assert.deepEqual(rowsToRules(input), expected);
});

test('sets all keys to undefined when the row is null', () => {
  const input = [null];
  const expected = [{ include: undefined, directory: undefined, name: undefined, value: undefined }];
  assert.deepEqual(rowsToRules(input), expected);
});

test('sets all keys to undefined when the row is a non-object value', () => {
  const input = [42];
  const expected = [{ include: undefined, directory: undefined, name: undefined, value: undefined }];
  assert.deepEqual(rowsToRules(input), expected);
});

test('drops keys outside the four canonical columns', () => {
  const input = [{ include: false, directory: 'd', name: 'n', value: 'v', extra: 'ignored' }];
  const expected = [{ include: false, directory: 'd', name: 'n', value: 'v' }];
  assert.deepEqual(rowsToRules(input), expected);
});
