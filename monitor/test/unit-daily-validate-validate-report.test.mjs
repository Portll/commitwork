// Returns schema validation errors for a daily report (monitor/daily-validate.mjs validateReport).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReport } from '../daily-validate.mjs';

test('returns an array of missing required keys when the report is an empty object', () => {
  const result = validateReport({});
  assert.deepEqual(result, [
    "schema: (root): required key 'schema' is missing",
    "schema: (root): required key 'area' is missing",
    "schema: (root): required key 'batch' is missing",
    "schema: (root): required key 'previousBatch' is missing",
    "schema: (root): required key 'digestId' is missing",
    "schema: (root): required key 'generatedAt' is missing",
    "schema: (root): required key 'summary' is missing",
    "schema: (root): required key 'coverage' is missing",
    "schema: (root): required key 'run' is missing",
    "schema: (root): required key 'headline' is missing",
    "schema: (root): required key 'suggestions' is missing",
    "schema: (root): required key 'notActioned' is missing"
  ]);
});

test('returns a type error when the report is null', () => {
  const result = validateReport(null);
  assert.deepEqual(result, ['schema: (root): expected object, got null']);
});

test('returns a type error when the report is undefined', () => {
  const result = validateReport(undefined);
  assert.deepEqual(result, ['schema: (root): expected object, got undefined']);
});

test('returns a type error when the report is an empty array', () => {
  const result = validateReport([]);
  assert.deepEqual(result, ['schema: (root): expected object, got array']);
});

test('returns a type error when the report is a string', () => {
  const result = validateReport('test');
  assert.deepEqual(result, ['schema: (root): expected object, got string']);
});

test('returns a type error when the report is a number', () => {
  const result = validateReport(123);
  assert.deepEqual(result, ['schema: (root): expected object, got number']);
});

test('returns a type error when the report is a boolean', () => {
  const result = validateReport(true);
  assert.deepEqual(result, ['schema: (root): expected object, got boolean']);
});

test('returns missing required keys and an unknown key error for an object with an extra key', () => {
  const result = validateReport({ a: { b: 1 } });
  assert.deepEqual(result, [
    "schema: (root): required key 'schema' is missing",
    "schema: (root): required key 'area' is missing",
    "schema: (root): required key 'batch' is missing",
    "schema: (root): required key 'previousBatch' is missing",
    "schema: (root): required key 'digestId' is missing",
    "schema: (root): required key 'generatedAt' is missing",
    "schema: (root): required key 'summary' is missing",
    "schema: (root): required key 'coverage' is missing",
    "schema: (root): required key 'run' is missing",
    "schema: (root): required key 'headline' is missing",
    "schema: (root): required key 'suggestions' is missing",
    "schema: (root): required key 'notActioned' is missing",
    "schema: (root): unknown key 'a' (additionalProperties: false)"
  ]);
});
