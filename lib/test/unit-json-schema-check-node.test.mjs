// Validates a JSON value against a draft-07 schema subset, pushing error strings (lib/json-schema.mjs checkNode).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNode } from '../json-schema.mjs';

test('accepts a value matching the schema type', () => {
  const errors = [];
  checkNode(42, { type: 'number' }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects a value of the wrong type', () => {
  const errors = [];
  checkNode('hello', { type: 'number' }, 'x', errors);
  assert.deepEqual(errors, ['x: expected number, got string']);
});

test('accepts an integer when type is integer', () => {
  const errors = [];
  checkNode(5, { type: 'integer' }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects a non-integer number when type is integer', () => {
  const errors = [];
  checkNode(5.5, { type: 'integer' }, 'x', errors);
  assert.deepEqual(errors, ['x: expected integer, got number']);
});

test('accepts a value in the enum list', () => {
  const errors = [];
  checkNode('a', { enum: ['a', 'b'] }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects a value not in the enum list', () => {
  const errors = [];
  checkNode('c', { enum: ['a', 'b'] }, 'x', errors);
  assert.deepEqual(errors, ['x: "c" is not one of ["a","b"]']);
});

test('accepts a value equal to const', () => {
  const errors = [];
  checkNode('v1', { const: 'v1' }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects a value not equal to const', () => {
  const errors = [];
  checkNode('v2', { const: 'v1' }, 'x', errors);
  assert.deepEqual(errors, ['x: expected the constant "v1", got "v2"']);
});

test('accepts a string matching the pattern', () => {
  const errors = [];
  checkNode('abc123', { pattern: '^[a-z]+[0-9]+$' }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects a string not matching the pattern', () => {
  const errors = [];
  checkNode('123abc', { pattern: '^[a-z]+[0-9]+$' }, 'x', errors);
  assert.deepEqual(errors, ['x: "123abc" does not match ^[a-z]+[0-9]+$']);
});

test('accepts a string at minLength boundary', () => {
  const errors = [];
  checkNode('abc', { minLength: 3 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects a string below minLength', () => {
  const errors = [];
  checkNode('ab', { minLength: 3 }, 'x', errors);
  assert.deepEqual(errors, ['x: string of length 2 is shorter than minLength 3']);
});

test('accepts a string at maxLength boundary', () => {
  const errors = [];
  checkNode('abc', { maxLength: 3 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects a string above maxLength', () => {
  const errors = [];
  checkNode('abcd', { maxLength: 3 }, 'x', errors);
  assert.deepEqual(errors, ['x: string of length 4 is longer than maxLength 3']);
});

test('accepts a number at minimum boundary', () => {
  const errors = [];
  checkNode(10, { minimum: 10 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects a number below minimum', () => {
  const errors = [];
  checkNode(9, { minimum: 10 }, 'x', errors);
  assert.deepEqual(errors, ['x: 9 < minimum 10']);
});

test('accepts a number at maximum boundary', () => {
  const errors = [];
  checkNode(10, { maximum: 10 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects a number above maximum', () => {
  const errors = [];
  checkNode(11, { maximum: 10 }, 'x', errors);
  assert.deepEqual(errors, ['x: 11 > maximum 10']);
});

test('accepts a number at exclusiveMinimum boundary plus epsilon', () => {
  const errors = [];
  checkNode(10.000001, { exclusiveMinimum: 10 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects a number at exclusiveMinimum boundary', () => {
  const errors = [];
  checkNode(10, { exclusiveMinimum: 10 }, 'x', errors);
  assert.deepEqual(errors, ['x: 10 must be > 10']);
});

test('accepts an array at minItems boundary', () => {
  const errors = [];
  checkNode([1, 2], { minItems: 2 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects an array below minItems', () => {
  const errors = [];
  checkNode([1], { minItems: 2 }, 'x', errors);
  assert.deepEqual(errors, ['x: needs at least 2 item(s), has 1']);
});

test('accepts an array at maxItems boundary', () => {
  const errors = [];
  checkNode([1, 2], { maxItems: 2 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects an array above maxItems', () => {
  const errors = [];
  checkNode([1, 2, 3], { maxItems: 2 }, 'x', errors);
  assert.deepEqual(errors, ['x: has 3 item(s), more than maxItems 2']);
});

test('accepts an array with unique items', () => {
  const errors = [];
  checkNode([1, 2, 3], { uniqueItems: true }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects an array with duplicate items', () => {
  const errors = [];
  checkNode([1, 2, 1], { uniqueItems: true }, 'x', errors);
  assert.deepEqual(errors, ['x[2]: duplicates item 0 (uniqueItems: true)']);
});

test('accepts an object with all required keys present', () => {
  const errors = [];
  checkNode({ a: 1, b: 2 }, { required: ['a', 'b'] }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects an object missing a required key', () => {
  const errors = [];
  checkNode({ a: 1 }, { required: ['a', 'b'] }, 'x', errors);
  assert.deepEqual(errors, ["x: required key 'b' is missing"]);
});

test('accepts an object with no additional keys when additionalProperties is false', () => {
  const errors = [];
  checkNode({ a: 1 }, { properties: { a: {} }, additionalProperties: false }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects an object with an unknown key when additionalProperties is false', () => {
  const errors = [];
  checkNode({ a: 1, b: 2 }, { properties: { a: {} }, additionalProperties: false }, 'x', errors);
  assert.deepEqual(errors, ["x: unknown key 'b' (additionalProperties: false)"]);
});

test('accepts an object with keys matching propertyNames pattern', () => {
  const errors = [];
  checkNode({ abc: 1, def: 2 }, { propertyNames: { pattern: '^[a-z]+$' } }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects an object with a key not matching propertyNames pattern', () => {
  const errors = [];
  checkNode({ abc: 1, ABC: 2 }, { propertyNames: { pattern: '^[a-z]+$' } }, 'x', errors);
  assert.deepEqual(errors, ['x: key "ABC" does not match propertyNames ^[a-z]+$']);
});

test('accepts a value matching exactly one oneOf branch', () => {
  const errors = [];
  checkNode(5, { oneOf: [{ type: 'number' }, { type: 'string' }] }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects a value matching no oneOf branches', () => {
  const errors = [];
  checkNode(true, { oneOf: [{ type: 'number' }, { type: 'string' }] }, 'x', errors);
  assert.deepEqual(errors, ['x: matched 0 of 2 oneOf branches (exactly 1 required)']);
});

test('rejects a value matching multiple oneOf branches', () => {
  const errors = [];
  checkNode(5, { oneOf: [{ type: 'number' }, { type: 'integer' }] }, 'x', errors);
  assert.deepEqual(errors, ['x: matched 2 of 2 oneOf branches (exactly 1 required)']);
});

test('validates array items recursively', () => {
  const errors = [];
  checkNode([1, 'a', 3], { type: 'array', items: { type: 'number' } }, 'x', errors);
  assert.deepEqual(errors, ['x[1]: expected number, got string']);
});

test('validates object properties recursively', () => {
  const errors = [];
  checkNode({ a: 1, b: 'x' }, { properties: { a: { type: 'number' }, b: { type: 'number' } } }, 'x', errors);
  assert.deepEqual(errors, ['x.b: expected number, got string']);
});

test('returns early on type mismatch without checking other keywords', () => {
  const errors = [];
  checkNode('hello', { type: 'number', minimum: 0, maximum: 100 }, 'x', errors);
  assert.deepEqual(errors, ['x: expected number, got string']);
});

test('accepts null when type is null', () => {
  const errors = [];
  checkNode(null, { type: 'null' }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects non-null when type is null', () => {
  const errors = [];
  checkNode(0, { type: 'null' }, 'x', errors);
  assert.deepEqual(errors, ['x: expected null, got number']);
});

test('accepts boolean when type is boolean', () => {
  const errors = [];
  checkNode(true, { type: 'boolean' }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects non-boolean when type is boolean', () => {
  const errors = [];
  checkNode(1, { type: 'boolean' }, 'x', errors);
  assert.deepEqual(errors, ['x: expected boolean, got number']);
});

test('accepts object when type is object', () => {
  const errors = [];
  checkNode({}, { type: 'object' }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects array when type is object', () => {
  const errors = [];
  checkNode([], { type: 'object' }, 'x', errors);
  assert.deepEqual(errors, ['x: expected object, got array']);
});

test('accepts array when type is array', () => {
  const errors = [];
  checkNode([], { type: 'array' }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects object when type is array', () => {
  const errors = [];
  checkNode({}, { type: 'array' }, 'x', errors);
  assert.deepEqual(errors, ['x: expected array, got object']);
});

test('accepts string when type is string', () => {
  const errors = [];
  checkNode('hi', { type: 'string' }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects number when type is string', () => {
  const errors = [];
  checkNode(42, { type: 'string' }, 'x', errors);
  assert.deepEqual(errors, ['x: expected string, got number']);
});

test('accepts value matching any type in a type array', () => {
  const errors = [];
  checkNode(5, { type: ['number', 'string'] }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects value not matching any type in a type array', () => {
  const errors = [];
  checkNode(true, { type: ['number', 'string'] }, 'x', errors);
  assert.deepEqual(errors, ['x: expected number|string, got boolean']);
});

test('validates additionalProperties schema for unknown keys', () => {
  const errors = [];
  checkNode({ a: 1, b: 'x' }, { properties: { a: { type: 'number' } }, additionalProperties: { type: 'number' } }, 'x', errors);
  assert.deepEqual(errors, ['x.b: expected number, got string']);
});

test('accepts empty object with no required keys', () => {
  const errors = [];
  checkNode({}, { required: [] }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects empty object with required keys', () => {
  const errors = [];
  checkNode({}, { required: ['a'] }, 'x', errors);
  assert.deepEqual(errors, ["x: required key 'a' is missing"]);
});

test('accepts empty array with minItems 0', () => {
  const errors = [];
  checkNode([], { minItems: 0 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects empty array with minItems 1', () => {
  const errors = [];
  checkNode([], { minItems: 1 }, 'x', errors);
  assert.deepEqual(errors, ['x: needs at least 1 item(s), has 0']);
});

test('accepts empty string with minLength 0', () => {
  const errors = [];
  checkNode('', { minLength: 0 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects empty string with minLength 1', () => {
  const errors = [];
  checkNode('', { minLength: 1 }, 'x', errors);
  assert.deepEqual(errors, ['x: string of length 0 is shorter than minLength 1']);
});

test('accepts empty string with maxLength 0', () => {
  const errors = [];
  checkNode('', { maxLength: 0 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects non-empty string with maxLength 0', () => {
  const errors = [];
  checkNode('a', { maxLength: 0 }, 'x', errors);
  assert.deepEqual(errors, ['x: string of length 1 is longer than maxLength 0']);
});

test('accepts zero at minimum 0', () => {
  const errors = [];
  checkNode(0, { minimum: 0 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects negative number at minimum 0', () => {
  const errors = [];
  checkNode(-1, { minimum: 0 }, 'x', errors);
  assert.deepEqual(errors, ['x: -1 < minimum 0']);
});

test('accepts zero at maximum 0', () => {
  const errors = [];
  checkNode(0, { maximum: 0 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects positive number at maximum 0', () => {
  const errors = [];
  checkNode(1, { maximum: 0 }, 'x', errors);
  assert.deepEqual(errors, ['x: 1 > maximum 0']);
});

test('accepts number above exclusiveMinimum 0', () => {
  const errors = [];
  checkNode(0.1, { exclusiveMinimum: 0 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects zero at exclusiveMinimum 0', () => {
  const errors = [];
  checkNode(0, { exclusiveMinimum: 0 }, 'x', errors);
  assert.deepEqual(errors, ['x: 0 must be > 0']);
});

test('accepts array with unique objects', () => {
  const errors = [];
  checkNode([{ a: 1 }, { a: 2 }], { uniqueItems: true }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects array with duplicate objects', () => {
  const errors = [];
  checkNode([{ a: 1 }, { a: 1 }], { uniqueItems: true }, 'x', errors);
  assert.deepEqual(errors, ['x[1]: duplicates item 0 (uniqueItems: true)']);
});

test('accepts value with no schema keywords', () => {
  const errors = [];
  checkNode(42, {}, 'x', errors);
  assert.deepEqual(errors, []);
});

test('accepts value with null schema', () => {
  const errors = [];
  checkNode(42, null, 'x', errors);
  assert.deepEqual(errors, []);
});

test('accepts value with undefined schema', () => {
  const errors = [];
  checkNode(42, undefined, 'x', errors);
  assert.deepEqual(errors, []);
});

test('uses root label when at is empty', () => {
  const errors = [];
  checkNode('x', { type: 'number' }, '', errors);
  assert.deepEqual(errors, ['(root): expected number, got string']);
});

test('uses root label when at is undefined', () => {
  const errors = [];
  checkNode('x', { type: 'number' }, undefined, errors);
  assert.deepEqual(errors, ['(root): expected number, got string']);
});

test('validates nested object properties with dotted paths', () => {
  const errors = [];
  checkNode({ a: { b: 'x' } }, { properties: { a: { properties: { b: { type: 'number' } } } } }, 'root', errors);
  assert.deepEqual(errors, ['root.a.b: expected number, got string']);
});

test('validates nested array items with bracket paths', () => {
  const errors = [];
  checkNode([[1, 'a']], { type: 'array', items: { type: 'array', items: { type: 'number' } } }, 'root', errors);
  assert.deepEqual(errors, ['root[0][1]: expected number, got string']);
});

test('accepts value matching enum with null', () => {
  const errors = [];
  checkNode(null, { enum: [null, 1] }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects value not in enum with null', () => {
  const errors = [];
  checkNode(2, { enum: [null, 1] }, 'x', errors);
  assert.deepEqual(errors, ['x: 2 is not one of [null,1]']);
});

test('accepts value matching const with null', () => {
  const errors = [];
  checkNode(null, { const: null }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects value not matching const with null', () => {
  const errors = [];
  checkNode(0, { const: null }, 'x', errors);
  assert.deepEqual(errors, ['x: expected the constant null, got 0']);
});

test('does not check pattern for non-string values', () => {
  const errors = [];
  checkNode(42, { pattern: '^[0-9]+$' }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('does not check minLength for non-string values', () => {
  const errors = [];
  checkNode(42, { minLength: 10 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('does not check maxLength for non-string values', () => {
  const errors = [];
  checkNode(42, { maxLength: 10 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('does not check minimum for non-number values', () => {
  const errors = [];
  checkNode('5', { minimum: 10 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('does not check maximum for non-number values', () => {
  const errors = [];
  checkNode('5', { maximum: 10 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('does not check exclusiveMinimum for non-number values', () => {
  const errors = [];
  checkNode('5', { exclusiveMinimum: 10 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('does not check minItems for non-array values', () => {
  const errors = [];
  checkNode(42, { minItems: 1 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('does not check maxItems for non-array values', () => {
  const errors = [];
  checkNode(42, { maxItems: 1 }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('does not check uniqueItems for non-array values', () => {
  const errors = [];
  checkNode(42, { uniqueItems: true }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('does not check required for non-object values', () => {
  const errors = [];
  checkNode(42, { required: ['a'] }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('does not check properties for non-object values', () => {
  const errors = [];
  checkNode(42, { properties: { a: { type: 'number' } } }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('does not check additionalProperties for non-object values', () => {
  const errors = [];
  checkNode(42, { additionalProperties: false }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('does not check propertyNames for non-object values', () => {
  const errors = [];
  checkNode(42, { propertyNames: { pattern: '^[a-z]+$' } }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('does not check propertyNames for arrays', () => {
  const errors = [];
  checkNode(['a', 'b'], { propertyNames: { pattern: '^[a-z]+$' } }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('does not check propertyNames for null', () => {
  const errors = [];
  checkNode(null, { propertyNames: { pattern: '^[a-z]+$' } }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('accepts object with all keys matching propertyNames pattern', () => {
  const errors = [];
  checkNode({ abc: 1, def: 2, ghi: 3 }, { propertyNames: { pattern: '^[a-z]{3}$' } }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('rejects object with one key not matching propertyNames pattern', () => {
  const errors = [];
  checkNode({ abc: 1, AB: 2 }, { propertyNames: { pattern: '^[a-z]{3}$' } }, 'x', errors);
  assert.deepEqual(errors, ['x: key "AB" does not match propertyNames ^[a-z]{3}$']);
});

test('reports multiple propertyNames violations', () => {
  const errors = [];
  checkNode({ AB: 1, CD: 2 }, { propertyNames: { pattern: '^[a-z]+$' } }, 'x', errors);
  assert.deepEqual(errors, ['x: key "AB" does not match propertyNames ^[a-z]+$', 'x: key "CD" does not match propertyNames ^[a-z]+$']);
});

test('accepts object with no keys when propertyNames is set', () => {
  const errors = [];
  checkNode({}, { propertyNames: { pattern: '^[a-z]+$' } }, 'x', errors);
  assert.deepEqual(errors, []);
});

test('validates multiple required keys missing', () => {
  const errors = [];
  checkNode({}, { required: ['a', 'b', 'c'] }, 'x', errors);
  assert.deepEqual(errors, ["x: required key 'a' is missing", "x: required key 'b' is missing", "x: required key 'c' is missing"]);
});

test('accepts object with extra keys when additionalProperties is not set', () => {
  const errors = [];
  checkNode({ a: 1, b: 2 }, { properties: { a: { type: 'number' } } }, 'x', errors);
  assert.deepEqual(errors, []);
});
