// Serializes stable measurement fields, excluding generatedAt and readCount (bin/docs-doctor.mjs measurementRaw).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measurementRaw } from '../docs-doctor.mjs';

test('returns empty object JSON when only generatedAt and readCount are present', () => {
  const result = { generatedAt: '2024-01-01T00:00:00Z', readCount: 42 };
  assert.equal(measurementRaw(result), '{}');
});

test('serializes stable fields when generatedAt and readCount are present', () => {
  const result = { generatedAt: '2024-01-01T00:00:00Z', readCount: 10, durationMs: 150, filesScanned: 5 };
  assert.equal(measurementRaw(result), '{"durationMs":150,"filesScanned":5}');
});

test('serializes stable fields when generatedAt is missing', () => {
  const result = { readCount: 10, durationMs: 150 };
  assert.equal(measurementRaw(result), '{"durationMs":150}');
});

test('serializes stable fields when readCount is missing', () => {
  const result = { generatedAt: '2024-01-01T00:00:00Z', durationMs: 150 };
  assert.equal(measurementRaw(result), '{"durationMs":150}');
});

test('serializes stable fields when both generatedAt and readCount are missing', () => {
  const result = { durationMs: 150, filesScanned: 5 };
  assert.equal(measurementRaw(result), '{"durationMs":150,"filesScanned":5}');
});

test('preserves key order of stable fields in output', () => {
  const result = { generatedAt: '2024-01-01T00:00:00Z', readCount: 10, zeta: 1, alpha: 2 };
  assert.equal(measurementRaw(result), '{"zeta":1,"alpha":2}');
});

test('handles null values in stable fields', () => {
  const result = { generatedAt: '2024-01-01T00:00:00Z', readCount: 10, value: null };
  assert.equal(measurementRaw(result), '{"value":null}');
});

test('handles undefined values in stable fields', () => {
  const result = { generatedAt: '2024-01-01T00:00:00Z', readCount: 10, value: undefined };
  assert.equal(measurementRaw(result), '{}');
});
