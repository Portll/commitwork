// Validates a CSAF document against a JSON schema, collecting errors, unchecked notes, and a checked count. (cra/csaf-validate.mjs validateCsaf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCsaf } from '../csaf-validate.mjs';

test('returns zero checked when the schema is null', () => {
  const r = validateCsaf({ a: 1 }, null);
  assert.deepEqual(r, { errors: [], unchecked: [], checked: 0 });
});

test('counts one check for a matching string type', () => {
  const r = validateCsaf('hello', { type: 'string' });
  assert.deepEqual(r, { errors: [], unchecked: [], checked: 1 });
});

test('reports a type mismatch for a number where a string is expected', () => {
  const r = validateCsaf(42, { type: 'string' });
  assert.deepEqual(r, { errors: ["$: expected string, got number"], unchecked: [], checked: 1 });
});

test('reports a pattern mismatch for a string that does not match', () => {
  const r = validateCsaf('abc', { type: 'string', pattern: '^[0-9]+$' });
  assert.deepEqual(r, { errors: ["$: \"abc\" does not match ^[0-9]+$"], unchecked: [], checked: 1 });
});

test('reports a minLength violation when the string is shorter', () => {
  const r = validateCsaf('ab', { type: 'string', minLength: 3 });
  assert.deepEqual(r, { errors: ["$: shorter than minLength 3"], unchecked: [], checked: 1 });
});

test('reports a minItems violation when the array is too short', () => {
  const r = validateCsaf([1], { type: 'array', minItems: 2, items: { type: 'number' } });
  assert.deepEqual(r, { errors: ["$: 1 items, minItems is 2"], unchecked: [], checked: 2 });
});

test('reports non-unique items in an array', () => {
  const r = validateCsaf([1, 1], { type: 'array', uniqueItems: true, items: { type: 'number' } });
  assert.deepEqual(r, { errors: ["$: items are not unique"], unchecked: [], checked: 3 });
});

test('reports a missing required property on an object', () => {
  const r = validateCsaf({ a: 1 }, { type: 'object', required: ['a', 'b'], properties: { a: { type: 'number' } } });
  assert.deepEqual(r, { errors: ["$: missing required property \"b\""], unchecked: [], checked: 2 });
});

test('reports a minProperties violation when the object has too few keys', () => {
  const r = validateCsaf({ a: 1 }, { type: 'object', minProperties: 2, properties: { a: { type: 'number' } } });
  assert.deepEqual(r, { errors: ["$: 1 properties, minProperties is 2"], unchecked: [], checked: 2 });
});

test('reports an additional property when additionalProperties is false', () => {
  const r = validateCsaf({ a: 1, b: 2 }, { type: 'object', properties: { a: { type: 'number' } }, additionalProperties: false });
  assert.deepEqual(r, { errors: ["$.b: not permitted (additionalProperties is false)"], unchecked: [], checked: 2 });
});
