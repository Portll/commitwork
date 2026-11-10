// Extracts string values from a PHP-serialized array (bin/lib/php-serialize.mjs stringList).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stringList } from '../lib/php-serialize.mjs';

test('returns string values from a serialized associative array', () => {
  const input = 'a:2:{s:1:"a";s:3:"foo";s:1:"b";s:3:"bar";}';
  const result = stringList(input);
  assert.deepEqual(result, ["foo", "bar"]);
});

test('returns empty array when serialized array has no string values', () => {
  const input = 'a:1:{i:0;i:42;}';
  const result = stringList(input);
  assert.deepEqual(result, []);
});

test('returns null when input is not a valid PHP serialization', () => {
  const input = 'not-valid-php';
  const result = stringList(input);
  assert.equal(result, null);
});

test('returns null when serialized value is a scalar string', () => {
  const input = 's:3:"foo";';
  const result = stringList(input);
  assert.equal(result, null);
});

test('returns null when serialized value is an integer', () => {
  const input = 'i:42;';
  const result = stringList(input);
  assert.equal(result, null);
});

test('returns null when serialized value is null', () => {
  const input = 'N;';
  const result = stringList(input);
  assert.equal(result, null);
});

test('returns null when serialized value is a boolean', () => {
  const input = 'b:1;';
  const result = stringList(input);
  assert.equal(result, null);
});

test('returns null when serialized value is a float', () => {
  const input = 'd:3.14;';
  const result = stringList(input);
  assert.equal(result, null);
});

test('returns null when serialized value is an object', () => {
  const input = 'O:4:"Test":1:{s:1:"x";s:3:"val";}';
  const result = stringList(input);
  assert.deepStrictEqual(result, ["Test", "val"]);
});

test('filters out non-string values from mixed array', () => {
  const input = 'a:3:{s:1:"a";s:3:"foo";i:0;i:42;s:1:"b";N;}';
  const result = stringList(input);
  assert.deepEqual(result, ["foo"]);
});
