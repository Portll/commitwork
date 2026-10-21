// Converts a rules array into an array of four-column row objects (monitor/sweep-rules.mjs rulesToRows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rulesToRows } from '../sweep-rules.mjs';

test('returns an empty array when the input is an empty array', () => {
  assert.deepEqual(rulesToRows([]), []);
});

test('returns an empty array when the input is null', () => {
  assert.deepEqual(rulesToRows(null), []);
});

test('returns an empty array when the input is undefined', () => {
  assert.deepEqual(rulesToRows(undefined), []);
});

test('returns an empty array when the input is a string', () => {
  assert.deepEqual(rulesToRows('rules'), []);
});

test('returns an empty array when the input is a number', () => {
  assert.deepEqual(rulesToRows(42), []);
});

test('returns an empty array when the input is a boolean', () => {
  assert.deepEqual(rulesToRows(true), []);
});

test('maps a single rule object to a row with all four columns set to undefined', () => {
  const result = rulesToRows([{}]);
  assert.deepEqual(result, [{ include: undefined, directory: undefined, name: undefined, value: undefined }]);
});

test('maps a rule object with all four keys to a row preserving their values', () => {
  const result = rulesToRows([{ include: true, directory: 'src', name: 'lint', value: 'eslint' }]);
  assert.deepEqual(result, [{ include: true, directory: 'src', name: 'lint', value: 'eslint' }]);
});

test('maps a rule object with only some keys to a row with missing keys as undefined', () => {
  const result = rulesToRows([{ include: false, name: 'test' }]);
  assert.deepEqual(result, [{ include: false, directory: undefined, name: 'test', value: undefined }]);
});

test('maps multiple rule objects to multiple rows in order', () => {
  const result = rulesToRows([
    { include: true, directory: 'a', name: 'x', value: 1 },
    { include: false, directory: 'b', name: 'y', value: 2 },
  ]);
  assert.deepEqual(result, [
    { include: true, directory: 'a', name: 'x', value: 1 },
    { include: false, directory: 'b', name: 'y', value: 2 },
  ]);
});
