// Normalizes a level list argument to an array, calling functions and coercing non-arrays to [] (admin/routes/perf.mjs levelList).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelList } from '../routes/perf.mjs';

test('returns the same array when given an array', () => {
  const input = ['a', 'b', 'c'];
  const result = levelList(input);
  assert.strictEqual(result, input);
  assert.deepEqual(result, ['a', 'b', 'c']);
});

test('returns an empty array when given an empty array', () => {
  const result = levelList([]);
  assert.deepEqual(result, []);
  assert.ok(Array.isArray(result));
});

test('returns the array returned by a function that returns an array', () => {
  const fn = () => ['x', 'y'];
  const result = levelList(fn);
  assert.deepEqual(result, ['x', 'y']);
});

test('returns an empty array when given a function that returns a non-array', () => {
  const fn = () => 'not-an-array';
  const result = levelList(fn);
  assert.deepEqual(result, []);
});

test('returns an empty array when given a function that throws', () => {
  const fn = () => { throw new Error('boom'); };
  const result = levelList(fn);
  assert.deepEqual(result, []);
});

test('returns an empty array when given a string', () => {
  const result = levelList('hello');
  assert.deepEqual(result, []);
});

test('returns an empty array when given a number', () => {
  const result = levelList(42);
  assert.deepEqual(result, []);
});

test('returns an empty array when given null', () => {
  const result = levelList(null);
  assert.deepEqual(result, []);
});

test('returns an empty array when given undefined', () => {
  const result = levelList(undefined);
  assert.deepEqual(result, []);
});

test('returns an empty array when given an object', () => {
  const result = levelList({ key: 'value' });
  assert.deepEqual(result, []);
});
