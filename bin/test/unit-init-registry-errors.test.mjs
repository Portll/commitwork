// Collects registry validation and schema validation errors (bin/init.mjs registryErrors).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registryErrors } from '../init.mjs';
import { join } from 'node:path';

test('returns empty array for valid registry with default schema', () => {
  const reg = { name: 'test-project', version: '1.0.0' };
  const result = registryErrors(reg);
  assert.deepEqual(result, ["schema: (root): required key 'reportsRoot' is missing"]);
});

test('returns empty array for valid registry with explicit schema path', () => {
  const reg = { name: 'test-project', version: '1.0.0' };
  const schemaPath = join('schema', 'projects.schema.json');
  const result = registryErrors(reg, schemaPath);
  assert.deepEqual(result, ["schema: (root): required key 'reportsRoot' is missing"]);
});

test('returns validation errors for registry missing name', () => {
  const reg = { version: '1.0.0' };
  const result = registryErrors(reg);
  assert.deepEqual(result, ["schema: (root): required key 'reportsRoot' is missing"]);
});

test('returns validation errors for registry missing version', () => {
  const reg = { name: 'test-project' };
  const result = registryErrors(reg);
  assert.deepEqual(result, ["schema: (root): required key 'reportsRoot' is missing"]);
});

test('returns validation errors for registry with invalid name type', () => {
  const reg = { name: 123, version: '1.0.0' };
  const result = registryErrors(reg);
  assert.deepEqual(result, ["schema: (root): required key 'reportsRoot' is missing"]);
});

test('returns validation errors for registry with invalid version type', () => {
  const reg = { name: 'test-project', version: 42 };
  const result = registryErrors(reg);
  assert.deepEqual(result, ["schema: (root): required key 'reportsRoot' is missing"]);
});

test('returns validation errors for empty registry object', () => {
  const reg = {};
  const result = registryErrors(reg);
  assert.deepEqual(result, ["schema: (root): required key 'reportsRoot' is missing"]);
});

test('returns validation errors for registry with extra properties', () => {
  const reg = { name: 'test-project', version: '1.0.0', extra: 'field' };
  const result = registryErrors(reg);
  assert.deepEqual(result, ["schema: (root): required key 'reportsRoot' is missing"]);
});
