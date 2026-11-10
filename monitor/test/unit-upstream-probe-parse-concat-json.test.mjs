// Parses concatenated JSON objects from a text stream, skipping noise between them (monitor/upstream-probe.mjs parseConcatJson).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConcatJson } from '../upstream-probe.mjs';

test('returns an empty array for empty input', () => {
  assert.deepEqual(parseConcatJson(''), []);
});

test('returns an empty array when only whitespace precedes the end', () => {
  assert.deepEqual(parseConcatJson('   '), []);
});

test('parses a single object with no surrounding noise', () => {
  assert.deepEqual(parseConcatJson('{"a":1}'), [{ a: 1 }]);
});

test('skips leading noise before the first object', () => {
  assert.deepEqual(parseConcatJson('garbage {"a":1}'), [{ a: 1 }]);
});

test('parses two objects separated by noise', () => {
  assert.deepEqual(parseConcatJson('{"a":1}noise{"b":2}'), [{ a: 1 }, { b: 2 }]);
});

test('handles nested objects and strings with braces', () => {
  assert.deepEqual(parseConcatJson('{"a":{"b":"}"},"c":"{"}'), [{ a: { b: "}" }, c: "{" }]);
});

test('handles escaped quotes inside strings', () => {
  assert.deepEqual(parseConcatJson('{"a":"\\"}'), []);
});

test('skips an unparseable chunk and continues to the next object', () => {
  assert.deepEqual(parseConcatJson('{"a":1}notjson{"b":2}'), [{ a: 1 }, { b: 2 }]);
});

test('stops when the object is never closed', () => {
  assert.deepEqual(parseConcatJson('{"a":1'), []);
});

test('handles a string containing an escaped backslash before a quote', () => {
  assert.deepEqual(parseConcatJson('{"a":"\\\\\\"}'), []);
});
