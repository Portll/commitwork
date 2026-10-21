// Detects injection signals in finding description and snippet fields (bin/finding-analysis.mjs untrustedSignals).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { untrustedSignals } from '../finding-analysis.mjs';

test('returns empty signals and fields for null input', () => {
  const result = untrustedSignals(null);
  assert.deepEqual(result, { signals: [], count: 0, fields: [] });
});

test('returns empty signals and fields for empty object', () => {
  const result = untrustedSignals({});
  assert.deepEqual(result, { signals: [], count: 0, fields: [] });
});

test('returns empty signals and fields when description is empty string', () => {
  const result = untrustedSignals({ description: '' });
  assert.deepEqual(result, { signals: [], count: 0, fields: [] });
});

test('returns empty signals and fields when description is whitespace only', () => {
  const result = untrustedSignals({ description: '   ' });
  assert.deepEqual(result, { signals: [], count: 0, fields: [] });
});

test('returns empty signals and fields when description is not a string', () => {
  const result = untrustedSignals({ description: 123 });
  assert.deepEqual(result, { signals: [], count: 0, fields: [] });
});

test('returns empty signals and fields when snippet is undefined', () => {
  const result = untrustedSignals({ snippet: undefined });
  assert.deepEqual(result, { signals: [], count: 0, fields: [] });
});

test('returns empty signals and fields when both fields are null', () => {
  const result = untrustedSignals({ description: null, snippet: null });
  assert.deepEqual(result, { signals: [], count: 0, fields: [] });
});

test('returns empty signals and fields when fields are non-string types', () => {
  const result = untrustedSignals({ description: 42, snippet: true });
  assert.deepEqual(result, { signals: [], count: 0, fields: [] });
});
