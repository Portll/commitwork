// Validates that every keyword in a JSON Schema tree is supported by the checker (lib/json-schema.mjs checkSchemaSupport).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSchemaSupport } from '../json-schema.mjs';

test('accepts an empty schema object without errors', () => {
  const errors = [];
  checkSchemaSupport({}, undefined, errors);
  assert.deepEqual(errors, []);
});

test('rejects a non-object schema with a specific error message', () => {
  const errors = [];
  checkSchemaSupport('string', undefined, errors);
  assert.deepEqual(errors, ['(root): subschema is not an object \u2014 the checker refuses to guess what it means']);
});

test('rejects an array schema with a specific error message', () => {
  const errors = [];
  checkSchemaSupport([], undefined, errors);
  assert.deepEqual(errors, ['(root): subschema is not an object \u2014 the checker refuses to guess what it means']);
});

test('rejects an unimplemented keyword in the root schema', () => {
  const errors = [];
  checkSchemaSupport({ type: 'string', minProperties: 1 }, undefined, errors);
  assert.deepEqual(errors, ["(root): schema keyword 'minProperties' is not implemented here, so no registry can be reported valid against it \u2014 implement it in lib/json-schema.mjs or drop it from the schema"]);
});

test('accepts all implemented keywords and annotations without errors', () => {
  const errors = [];
  const schema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'test',
    $comment: 'comment',
    title: 'Title',
    description: 'Desc',
    default: 'val',
    examples: ['a'],
    type: 'string',
    required: ['a'],
    properties: {},
    additionalProperties: false,
    items: {},
    pattern: '^a',
    enum: ['a'],
    minItems: 0,
    uniqueItems: true,
    minimum: 0,
    maximum: 10,
    exclusiveMinimum: 0,
    oneOf: [],
    const: 'x',
    minLength: 1,
    maxLength: 10,
    maxItems: 5,
    propertyNames: {}
  };
  checkSchemaSupport(schema, undefined, errors);
  assert.deepEqual(errors, []);
});

test('reports unimplemented keyword in nested properties with correct path', () => {
  const errors = [];
  const schema = {
    properties: {
      name: {
        type: 'string',
        minProperties: 1
      }
    }
  };
  checkSchemaSupport(schema, undefined, errors);
  assert.deepEqual(errors, ["name: schema keyword 'minProperties' is not implemented here, so no registry can be reported valid against it \u2014 implement it in lib/json-schema.mjs or drop it from the schema"]);
});

test('reports unimplemented keyword in items with correct path', () => {
  const errors = [];
  const schema = {
    type: 'array',
    items: {
      type: 'string',
      minProperties: 1
    }
  };
  checkSchemaSupport(schema, undefined, errors);
  assert.deepEqual(errors, ["undefined[]: schema keyword 'minProperties' is not implemented here, so no registry can be reported valid against it \u2014 implement it in lib/json-schema.mjs or drop it from the schema"]);
});

test('reports unimplemented keyword in additionalProperties with correct path', () => {
  const errors = [];
  const schema = {
    type: 'object',
    additionalProperties: {
      type: 'string',
      minProperties: 1
    }
  };
  checkSchemaSupport(schema, undefined, errors);
  assert.deepEqual(errors, ["undefined.*: schema keyword 'minProperties' is not implemented here, so no registry can be reported valid against it \u2014 implement it in lib/json-schema.mjs or drop it from the schema"]);
});

test('reports unimplemented keyword in oneOf with correct path', () => {
  const errors = [];
  const schema = {
    oneOf: [
      { type: 'string' },
      { type: 'number', minProperties: 1 }
    ]
  };
  checkSchemaSupport(schema, undefined, errors);
  assert.deepEqual(errors, ["undefined|oneOf[1]: schema keyword 'minProperties' is not implemented here, so no registry can be reported valid against it \u2014 implement it in lib/json-schema.mjs or drop it from the schema"]);
});

test('uses provided at parameter for error paths', () => {
  const errors = [];
  const schema = {
    type: 'string',
    minProperties: 1
  };
  checkSchemaSupport(schema, 'parent.child', errors);
  assert.deepEqual(errors, ["parent.child: schema keyword 'minProperties' is not implemented here, so no registry can be reported valid against it \u2014 implement it in lib/json-schema.mjs or drop it from the schema"]);
});
