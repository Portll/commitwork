// Parses a tag string into type, n, and context fields (bin/agent-tag.mjs parseTag).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTag } from '../agent-tag.mjs';

test('parses a valid tag with minimal type and context', () => {
  const result = parseTag('AB-001-a');
  assert.deepEqual(result, { type: 'AB', n: 1, context: 'a' });
});

test('parses a valid tag with maximum length type', () => {
  const type = 'A'.repeat(12);
  const result = parseTag(`${type}-001-a`);
  assert.deepEqual(result, { type, n: 1, context: 'a' });
});

test('parses a valid tag with maximum length context', () => {
  const context = 'a'.repeat(32);
  const result = parseTag(`AB-001-${context}`);
  assert.deepEqual(result, { type: 'AB', n: 1, context });
});

test('parses a valid tag with maximum numeric value', () => {
  const result = parseTag('AB-999999-a');
  assert.deepEqual(result, { type: 'AB', n: 999999, context: 'a' });
});

test('returns null for type shorter than minimum length', () => {
  const result = parseTag('A-001-a');
  assert.equal(result, null);
});

test('returns null for type longer than maximum length', () => {
  const type = 'A'.repeat(13);
  const result = parseTag(`${type}-001-a`);
  assert.equal(result, null);
});

test('returns null for numeric part shorter than minimum length', () => {
  const result = parseTag('AB-01-a');
  assert.equal(result, null);
});

test('returns null for numeric part longer than maximum length', () => {
  const result = parseTag('AB-0000001-a');
  assert.equal(result, null);
});

test('returns null for context starting with uppercase letter', () => {
  const result = parseTag('AB-001-A');
  assert.equal(result, null);
});

test('returns null for empty string input', () => {
  const result = parseTag('');
  assert.equal(result, null);
});
