// Extracts the first JSON object from a string (bin/rate-llm.mjs extractJSON).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJSON } from '../rate-llm.mjs';

test('returns null when input is null', () => {
  assert.equal(extractJSON(null), null);
});

test('returns null when input is an empty string', () => {
  assert.equal(extractJSON(''), null);
});

test('returns null when input has no opening brace', () => {
  assert.equal(extractJSON('hello world'), null);
});

test('returns parsed object for a simple JSON object', () => {
  assert.deepEqual(extractJSON('{"a":1}'), { a: 1 });
});

test('returns parsed object when JSON is preceded by text', () => {
  assert.deepEqual(extractJSON('prefix {"b":2} suffix'), { b: 2 });
});

test('returns null when JSON is invalid', () => {
  assert.equal(extractJSON('{"a":1'), null);
});

test('returns parsed object for nested JSON', () => {
  assert.deepEqual(extractJSON('{"x":{"y":3}}'), { x: { y: 3 } });
});

test('returns null when input is a number', () => {
  assert.equal(extractJSON(42), null);
});

test('returns parsed object when JSON is at start of string', () => {
  assert.deepEqual(extractJSON('{"z":5}'), { z: 5 });
});

test('returns null when braces are unbalanced', () => {
  assert.equal(extractJSON('{"a":1'), null);
});
