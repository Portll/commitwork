// Validates that every encoding covers all schema dimensions with known vocabulary values (bin/taxonomy-lattice.mjs validate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../taxonomy-lattice.mjs';

test('returns an empty array when the encoding is fully valid', () => {
  const schema = { color: { values: ['red', 'blue'] }, size: { values: ['small', 'large'] } };
  const encodings = { a: { color: ['red'], size: ['small'] } };
  assert.deepEqual(validate({ schema, encodings }), []);
});

test('reports a missing dimension when the key is absent', () => {
  const schema = { color: { values: ['red'] }, size: { values: ['small'] } };
  const encodings = { a: { color: ['red'] } };
  assert.deepEqual(validate({ schema, encodings }), ["a: missing dimension 'size'"]);
});

test('reports a missing dimension when the value list is empty', () => {
  const schema = { color: { values: ['red'] }, size: { values: ['small'] } };
  const encodings = { a: { color: ['red'], size: [] } };
  assert.deepEqual(validate({ schema, encodings }), ["a: missing dimension 'size'"]);
});

test('reports an unknown dimension that is not in the schema', () => {
  const schema = { color: { values: ['red'] } };
  const encodings = { a: { color: ['red'], shape: ['circle'] } };
  assert.deepEqual(validate({ schema, encodings }), ["a: unknown dimension 'shape'"]);
});

test('reports a value that is not in the dimension vocabulary', () => {
  const schema = { color: { values: ['red', 'blue'] } };
  const encodings = { a: { color: ['green'] } };
  assert.deepEqual(validate({ schema, encodings }), ["a: 'green' is not in the 'color' vocabulary"]);
});

test('reports mixing the unconstrained wildcard with concrete values', () => {
  const schema = { color: { values: ['red', 'blue'] } };
  const encodings = { a: { color: ['*', 'red'] } };
  assert.deepEqual(validate({ schema, encodings }), ["a: 'color' mixes '*' with concrete values"]);
});

test('accepts the unconstrained wildcard alone without a problem', () => {
  const schema = { color: { values: ['red', 'blue'] } };
  const encodings = { a: { color: ['*'] } };
  assert.deepEqual(validate({ schema, encodings }), []);
});

test('reports a missing dimension when the key is undefined', () => {
  const schema = { color: { values: ['red'] }, size: { values: ['small'] } };
  const encodings = { a: { color: ['red'], size: undefined } };
  assert.throws(() => validate({ schema, encodings }), { name: "TypeError", message: "Cannot read properties of undefined (reading 'includes')" });
});
