// The annotation-free structural shape of a JSON Schema node (bin/lib/format-freeze.mjs schemaShape).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemaShape } from '../lib/format-freeze.mjs';

test('returns null, undefined and other primitives unchanged', () => {
  assert.equal(schemaShape(null), null);
  assert.equal(schemaShape(undefined), undefined);
  assert.equal(schemaShape(0), 0);
  assert.equal(schemaShape(''), '');
  assert.equal(schemaShape(false), false);
  assert.equal(schemaShape('hello'), 'hello');
  assert.equal(schemaShape(42), 42);
  assert.equal(schemaShape(true), true);
});

test('drops annotation keys and keeps the other keys of an object', () => {
  const input = { description: 'd', title: 't', $comment: 'c', examples: [1], type: 'string', minLength: 2 };
  assert.deepEqual(schemaShape(input), { type: 'string', minLength: 2 });
});

test('strips annotations inside each schema map entry but keeps the entry names', () => {
  const input = {
    type: 'object',
    properties: { description: { type: 'string', description: 'x' }, b: { title: 't' } },
    definitions: { c: { examples: [1], minimum: 0 } },
    dependentSchemas: { d: {} },
  };
  assert.deepEqual(schemaShape(input), {
    type: 'object',
    properties: { description: { type: 'string' }, b: {} },
    definitions: { c: { minimum: 0 } },
    dependentSchemas: { d: {} },
  });
});

test('keeps a schema map keyword whose value is an array, a number or null exactly as given', () => {
  const input = { properties: [{ description: 'd' }], patternProperties: 5, $defs: null };
  assert.deepEqual(schemaShape(input), { properties: [{ description: 'd' }], patternProperties: 5, $defs: null });
});

test('copies a plain object or null under a non-schema keyword without stripping it', () => {
  const input = { const: { a: { description: 'x', b: 1 } }, default: null };
  assert.deepEqual(schemaShape(input), { const: { a: { description: 'x', b: 1 } }, default: null });
});

test('recurses into each element of allOf, anyOf, oneOf and prefixItems', () => {
  const input = {
    allOf: [{ description: 'd', type: 'string' }],
    anyOf: [{ title: 't' }, 1],
    oneOf: [],
    prefixItems: [[{ $comment: 'c', x: 1 }]],
  };
  assert.deepEqual(schemaShape(input), {
    allOf: [{ type: 'string' }],
    anyOf: [{}, 1],
    oneOf: [],
    prefixItems: [[{ x: 1 }]],
  });
});

test('keeps a list keyword whose value is not an array exactly as given', () => {
  const input = { allOf: 'x', oneOf: { description: 'd' } };
  assert.deepEqual(schemaShape(input), { allOf: 'x', oneOf: { description: 'd' } });
});

test('copies arrays under non-schema keywords without stripping their elements', () => {
  const input = { enum: [{ description: 'x', v: 1 }], required: ['a', 'b'] };
  assert.deepEqual(schemaShape(input), { enum: [{ description: 'x', v: 1 }], required: ['a', 'b'] });
});

test('recurses into single-schema keywords and passes their primitive values through', () => {
  const input = { items: { description: 'd', type: 'number' }, not: 'x', if: null, additionalProperties: false };
  assert.deepEqual(schemaShape(input), { items: { type: 'number' }, not: 'x', if: null, additionalProperties: false });
});

test('maps a top-level array element by element', () => {
  assert.deepEqual(schemaShape([{ title: 't', type: 'x' }, 'y', null]), [{ type: 'x' }, 'y', null]);
});
