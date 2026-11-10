// Appends every element of an iterable onto target one at a time and returns target (bin/secrets-sweep.mjs pushAll).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushAll } from '../secrets-sweep.mjs';

test('appends all elements of src after the existing elements of target', () => {
  const target = [1, 2];
  const src = [3, 4, 5];
  const r = pushAll(target, src);
  assert.deepEqual(r, [1, 2, 3, 4, 5]);
  assert.deepEqual(src, [3, 4, 5]);
});

test('returns the very same array object that was passed as target', () => {
  const target = [];
  const src = ['a', 'b'];
  const r = pushAll(target, src);
  assert.equal(r, target);
  assert.deepEqual(target, ['a', 'b']);
});

test('leaves target unchanged and returns it when src is empty', () => {
  const target = [10, 20];
  const r = pushAll(target, []);
  assert.equal(r, target);
  assert.deepEqual(r, [10, 20]);
});

test('appends a single element src to target', () => {
  const target = ['x'];
  const r = pushAll(target, ['y']);
  assert.deepEqual(r, ['x', 'y']);
});

test('fills an empty target with every element of src in order', () => {
  const r = pushAll([], [1, 2, 3, 4, 5]);
  assert.deepEqual(r, [1, 2, 3, 4, 5]);
});

test('appends more than 125000 elements without throwing a RangeError', () => {
  const target = [-1];
  const src = Array.from({ length: 130000 }, (_, i) => i);
  const r = pushAll(target, src);
  assert.equal(r, target);
  assert.equal(r.length, 130001);
  assert.equal(r[0], -1);
  assert.equal(r[1], 0);
  assert.equal(r[130000], 129999);
});

test('appends each value yielded by a generator', () => {
  const src = (function* () { yield 1; yield 2; yield 3; })();
  const r = pushAll([], src);
  assert.deepEqual(r, [1, 2, 3]);
});

test('appends each character of a string src as its own element', () => {
  const r = pushAll([], 'abc');
  assert.deepEqual(r, ['a', 'b', 'c']);
});

test('pushes nested arrays as single elements without flattening them', () => {
  const r = pushAll([0], [[1, 2], [3]]);
  assert.deepEqual(r, [0, [1, 2], [3]]);
});

test('appends the distinct values of a Set in insertion order', () => {
  const r = pushAll(['start'], new Set([2, 1, 2, 3]));
  assert.deepEqual(r, ['start', 2, 1, 3]);
});
