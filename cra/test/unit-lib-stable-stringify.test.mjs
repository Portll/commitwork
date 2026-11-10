// canonical JSON string with sorted keys and undefined values omitted (cra/lib.mjs stableStringify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stableStringify } from '../lib.mjs';

test('undefined input serializes to the string null', () => {
  assert.equal(stableStringify(undefined), "null");
});

test('null input serializes to the string null', () => {
  assert.equal(stableStringify(null), "null");
});

test('string input serializes with quotes', () => {
  assert.equal(stableStringify('hello'), "\"hello\"");
});

test('number input serializes as a JSON number', () => {
  assert.equal(stableStringify(42), "42");
});

test('boolean input serializes as a JSON boolean', () => {
  assert.equal(stableStringify(true), "true");
});

test('array input serializes elements in order', () => {
  assert.equal(stableStringify([1, 'two', null]), "[1,\"two\",null]");
});

test('array with undefined element serializes that element as null', () => {
  assert.equal(stableStringify([1, undefined, 3]), "[1,null,3]");
});

test('object with sorted keys and undefined values omitted', () => {
  assert.equal(stableStringify({ b: 2, a: 1, c: undefined }), "{\"a\":1,\"b\":2}");
});

test('nested object serializes with sorted keys at every level', () => {
  assert.equal(stableStringify({ z: { y: 1, x: 2 }, a: [3, 4] }), "{\"a\":[3,4],\"z\":{\"x\":2,\"y\":1}}");
});

test('empty object serializes to empty braces', () => {
  assert.equal(stableStringify({}), "{}");
});
