// Parses a workflow YAML document into a token tree with validation errors (lib/actions-workflow.mjs readWorkflowTokens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWorkflowTokens } from '../actions-workflow.mjs';

test('returns a token tree for a valid mapping', () => {
  const input = 'name: test\nsteps: []';
  const result = readWorkflowTokens(input);
  assert.deepEqual(result, { tokens: { t: "map", line: 1, col: 1, entries: [{ key: { t: "string", value: "name", line: 1, col: 1, source: "name", style: "plain", def: { def: { name: "workflow-name", kind: "string", context: [], oneOf: undefined, constant: "", ignoreCase: false, requireNonEmpty: false }, allowedContext: [] } }, value: { t: "string", value: "test", line: 1, col: 7, source: "test", style: "plain", def: { def: { name: "workflow-name", kind: "string", context: [], oneOf: undefined, constant: "", ignoreCase: false, requireNonEmpty: false }, allowedContext: [] } } }], def: { def: { name: "workflow-root-strict", kind: "mapping", context: [], oneOf: undefined, properties: { on: { type: "on-strict", required: true }, name: { type: "workflow-name", required: false }, description: { type: "workflow-description", required: false }, "run-name": { type: "run-name", required: false }, defaults: { type: "workflow-defaults", required: false }, env: { type: "workflow-env", required: false }, permissions: { type: "permissions", required: false }, concurrency: { type: "workflow-concurrency", required: false }, jobs: { type: "jobs", required: true } }, looseKeyType: undefined, looseValueType: undefined }, allowedContext: [] } }, errors: [{ message: "Unexpected value 'steps'", line: 2, col: 1 }, { message: "Required property is missing: on", line: 1, col: 1 }, { message: "Required property is missing: jobs", line: 1, col: 1 }], expressions: [] });
});

test('returns a token tree for a valid sequence', () => {
  const input = '- a\n- b';
  const result = readWorkflowTokens(input);
  assert.deepEqual(result, { tokens: { t: "seq", line: 1, col: 1, items: [], def: { def: { name: "workflow-root-strict", kind: "mapping", context: [], oneOf: undefined, properties: { on: { type: "on-strict", required: true }, name: { type: "workflow-name", required: false }, description: { type: "workflow-description", required: false }, "run-name": { type: "run-name", required: false }, defaults: { type: "workflow-defaults", required: false }, env: { type: "workflow-env", required: false }, permissions: { type: "permissions", required: false }, concurrency: { type: "workflow-concurrency", required: false }, jobs: { type: "jobs", required: true } }, looseKeyType: undefined, looseValueType: undefined }, allowedContext: [] } }, errors: [{ message: "A sequence was not expected", line: 1, col: 1 }], expressions: [] });
});

test('returns a token tree for a valid scalar string', () => {
  const input = 'hello';
  const result = readWorkflowTokens(input);
  assert.deepEqual(result, { tokens: { t: "string", value: "hello", line: 1, col: 1, source: "hello", style: "plain" }, errors: [{ message: "Unexpected value 'hello'", line: 1, col: 1 }], expressions: [] });
});

test('returns a token tree for an empty document', () => {
  const input = '';
  const result = readWorkflowTokens(input);
  assert.deepEqual(result, { tokens: undefined, errors: [{ message: "Expected a scalar value, a sequence, or a mapping", line: 0, col: 0 }], expressions: [] });
});

test('returns a token tree for a nested mapping with expressions', () => {
  const input = 'name: test\nsteps:\n  - run: ${{ github.event }}';
  const result = readWorkflowTokens(input);
  assert.deepEqual(result, { tokens: { t: "map", line: 1, col: 1, entries: [{ key: { t: "string", value: "name", line: 1, col: 1, source: "name", style: "plain", def: { def: { name: "workflow-name", kind: "string", context: [], oneOf: undefined, constant: "", ignoreCase: false, requireNonEmpty: false }, allowedContext: [] } }, value: { t: "string", value: "test", line: 1, col: 7, source: "test", style: "plain", def: { def: { name: "workflow-name", kind: "string", context: [], oneOf: undefined, constant: "", ignoreCase: false, requireNonEmpty: false }, allowedContext: [] } } }], def: { def: { name: "workflow-root-strict", kind: "mapping", context: [], oneOf: undefined, properties: { on: { type: "on-strict", required: true }, name: { type: "workflow-name", required: false }, description: { type: "workflow-description", required: false }, "run-name": { type: "run-name", required: false }, defaults: { type: "workflow-defaults", required: false }, env: { type: "workflow-env", required: false }, permissions: { type: "permissions", required: false }, concurrency: { type: "workflow-concurrency", required: false }, jobs: { type: "jobs", required: true } }, looseKeyType: undefined, looseValueType: undefined }, allowedContext: [] } }, errors: [{ message: "Unexpected value 'steps'", line: 2, col: 1 }, { message: "Required property is missing: on", line: 1, col: 1 }, { message: "Required property is missing: jobs", line: 1, col: 1 }], expressions: [] });
});

test('returns a token tree for a mapping with loose keys', () => {
  const input = 'foo: bar\nbaz: qux';
  const result = readWorkflowTokens(input);
  assert.deepEqual(result, { tokens: { t: "map", line: 1, col: 1, entries: [], def: { def: { name: "workflow-root-strict", kind: "mapping", context: [], oneOf: undefined, properties: { on: { type: "on-strict", required: true }, name: { type: "workflow-name", required: false }, description: { type: "workflow-description", required: false }, "run-name": { type: "run-name", required: false }, defaults: { type: "workflow-defaults", required: false }, env: { type: "workflow-env", required: false }, permissions: { type: "permissions", required: false }, concurrency: { type: "workflow-concurrency", required: false }, jobs: { type: "jobs", required: true } }, looseKeyType: undefined, looseValueType: undefined }, allowedContext: [] } }, errors: [{ message: "Unexpected value 'foo'", line: 1, col: 1 }, { message: "Unexpected value 'baz'", line: 2, col: 1 }, { message: "Required property is missing: on", line: 1, col: 1 }, { message: "Required property is missing: jobs", line: 1, col: 1 }], expressions: [] });
});

test('returns a token tree for a sequence of mappings', () => {
  const input = '- name: a\n  run: x\n- name: b\n  run: y';
  const result = readWorkflowTokens(input);
  assert.deepEqual(result, { tokens: { t: "seq", line: 1, col: 1, items: [], def: { def: { name: "workflow-root-strict", kind: "mapping", context: [], oneOf: undefined, properties: { on: { type: "on-strict", required: true }, name: { type: "workflow-name", required: false }, description: { type: "workflow-description", required: false }, "run-name": { type: "run-name", required: false }, defaults: { type: "workflow-defaults", required: false }, env: { type: "workflow-env", required: false }, permissions: { type: "permissions", required: false }, concurrency: { type: "workflow-concurrency", required: false }, jobs: { type: "jobs", required: true } }, looseKeyType: undefined, looseValueType: undefined }, allowedContext: [] } }, errors: [{ message: "A sequence was not expected", line: 1, col: 1 }], expressions: [] });
});

test('returns a token tree for a boolean value', () => {
  const input = 'true';
  const result = readWorkflowTokens(input);
  assert.deepEqual(result, { tokens: { t: "boolean", value: true, line: 1, col: 1, source: "true", style: "plain" }, errors: [{ message: "Unexpected value 'true'", line: 1, col: 1 }], expressions: [] });
});

test('returns a token tree for a number value', () => {
  const input = '42';
  const result = readWorkflowTokens(input);
  assert.deepEqual(result, { tokens: { t: "number", value: 42, line: 1, col: 1, source: "42", style: "plain" }, errors: [{ message: "Unexpected value '42'", line: 1, col: 1 }], expressions: [] });
});

test('returns error with line and col for invalid YAML', () => {
  const input = '[}';
  const result = readWorkflowTokens(input);
  assert.deepEqual(result, { tokens: undefined, errors: [{ message: "line 1: unexpected '}' in a flow collection", line: 1, col: 2 }], expressions: [] });
});
