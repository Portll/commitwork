// Maps each check id to the 1-based line of its first literal "id" declaration (bin/manifest-map.mjs idLines).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idLines } from '../manifest-map.mjs';

test('returns a map with null for ids not present in the text', () => {
  const text = 'no ids here';
  const result = idLines(text, ['a', 'b']);
  assert.deepEqual(result, new Map([['a', null], ['b', null]]));
});

test('maps an id to its 1-based line number when found', () => {
  const text = 'line one\n{"id": "alpha"}\nline three';
  const result = idLines(text, ['alpha']);
  assert.deepEqual(result, new Map([['alpha', 2]]));
});

test('keeps the first occurrence when an id appears on multiple lines', () => {
  const text = '{"id": "x"}\n{"id": "y"}\n{"id": "x"}';
  const result = idLines(text, ['x', 'y']);
  assert.deepEqual(result, new Map([['x', 1], ['y', 2]]));
});

test('ignores id strings that are not in the requested ids list', () => {
  const text = '{"id": "other"}\n{"id": "target"}';
  const result = idLines(text, ['target']);
  assert.deepEqual(result, new Map([['target', 2]]));
});

test('handles whitespace between the id key and value', () => {
  const text = '  "id"   :   "spaced"  ';
  const result = idLines(text, ['spaced']);
  assert.deepEqual(result, new Map([['spaced', 1]]));
});

test('returns null for an id when the text is empty', () => {
  const result = idLines('', ['missing']);
  assert.deepEqual(result, new Map([['missing', null]]));
});

test('maps multiple distinct ids to their respective lines', () => {
  const text = '{"id": "one"}\n{"id": "two"}\n{"id": "three"}';
  const result = idLines(text, ['one', 'two', 'three']);
  assert.deepEqual(result, new Map([['one', 1], ['two', 2], ['three', 3]]));
});

test('preserves the order of ids as given in the input array', () => {
  const text = '{"id": "z"}\n{"id": "a"}';
  const result = idLines(text, ['z', 'a']);
  const keys = [...result.keys()];
  assert.deepEqual(keys, ['z', 'a']);
  assert.deepEqual(result, new Map([['z', 1], ['a', 2]]));
});
