// Validates a registry object against the projects JSON schema (monitor/registry.mjs validateAgainstSchema).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAgainstSchema } from '../registry.mjs';

test('returns the validation result for a minimal valid registry', () => {
  const reg = { name: 'proj', version: '1.0.0' };
  const r = validateAgainstSchema(reg);
  assert.deepEqual(r, { errors: ["schema: (root): required key 'reportsRoot' is missing"] });
});

test('returns the validation result for a registry with all optional fields', () => {
  const reg = { name: 'proj', version: '1.0.0', description: 'd', tags: ['a', 'b'] };
  const r = validateAgainstSchema(reg);
  assert.deepEqual(r, { errors: ["schema: (root): required key 'reportsRoot' is missing"] });
});

test('returns the validation result when version is missing', () => {
  const reg = { name: 'proj' };
  const r = validateAgainstSchema(reg);
  assert.deepEqual(r, { errors: ["schema: (root): required key 'reportsRoot' is missing"] });
});

test('returns the validation result when name is missing', () => {
  const reg = { version: '1.0.0' };
  const r = validateAgainstSchema(reg);
  assert.deepEqual(r, { errors: ["schema: (root): required key 'reportsRoot' is missing"] });
});

test('returns the validation result for an empty registry object', () => {
  const reg = {};
  const r = validateAgainstSchema(reg);
  assert.deepEqual(r, { errors: ["schema: (root): required key 'reportsRoot' is missing"] });
});

test('returns the validation result when registry is null', () => {
  const reg = null;
  const r = validateAgainstSchema(reg);
  assert.deepEqual(r, { errors: ["schema: (root): expected object, got null"] });
});

test('returns the validation result when registry is undefined', () => {
  const reg = undefined;
  const r = validateAgainstSchema(reg);
  assert.deepEqual(r, { errors: ["schema: (root): expected object, got undefined"] });
});

test('returns the validation result when registry is a string', () => {
  const reg = 'not-an-object';
  const r = validateAgainstSchema(reg);
  assert.deepEqual(r, { errors: ["schema: (root): expected object, got string"] });
});

test('returns the validation result when registry is an array', () => {
  const reg = [1, 2, 3];
  const r = validateAgainstSchema(reg);
  assert.deepEqual(r, { errors: ["schema: (root): expected object, got array"] });
});

test('returns the validation result when registry is a number', () => {
  const reg = 42;
  const r = validateAgainstSchema(reg);
  assert.deepEqual(r, { errors: ["schema: (root): expected object, got number"] });
});
