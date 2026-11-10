// Returns unserialized PHP value or fallback on error (bin/lib/php-serialize.mjs tryUnserialize).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tryUnserialize } from '../lib/php-serialize.mjs';

test('returns null for N type', () => {
  const result = tryUnserialize('N;');
  assert.equal(result, null);
});

test('returns true for boolean 1', () => {
  const result = tryUnserialize('b:1;');
  assert.equal(result, true);
});

test('returns false for boolean 0', () => {
  const result = tryUnserialize('b:0;');
  assert.equal(result, false);
});

test('returns integer for i type', () => {
  const result = tryUnserialize('i:42;');
  assert.equal(result, 42);
});

test('returns negative integer', () => {
  const result = tryUnserialize('i:-7;');
  assert.equal(result, -7);
});

test('returns float for d type', () => {
  const result = tryUnserialize('d:3.14;');
  assert.equal(result, 3.14);
});

test('returns string for s type', () => {
  const result = tryUnserialize('s:5:"hello";');
  assert.equal(result, 'hello');
});

test('returns empty array for a:0', () => {
  const result = tryUnserialize('a:0:{}');
  assert.deepEqual(result, Object.create(null));
});

test('returns array with string keys', () => {
  const result = tryUnserialize('a:2:{s:1:"a";i:1;s:1:"b";i:2;}');
  assert.deepEqual(result, Object.assign(Object.create(null), { a: 1, b: 2 }));
});

test('returns object with __class and properties', () => {
  const result = tryUnserialize('O:8:"stdClass":1:{s:3:"foo";i:42;}');
  assert.deepEqual(result, Object.assign(Object.create(null), { __class: 'stdClass', foo: 42 }));
});

test('returns fallback on malformed input', () => {
  const result = tryUnserialize('x:1;', 'fallback');
  assert.equal(result, 'fallback');
});

test('throws on trailing bytes when no fallback', () => {
  assert.equal(tryUnserialize('i:1;extra'), undefined);
});
