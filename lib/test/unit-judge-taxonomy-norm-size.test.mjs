// Normalizes a size label to a canonical size or undetermined (lib/judge-taxonomy.mjs normSize).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normSize } from '../judge-taxonomy.mjs';

test('maps lowercase alias to canonical size', () => {
  const input = 'small';
  const result = normSize(input);
  assert.equal(result, "S");
});

test('maps mixed-case alias to canonical size', () => {
  const input = 'MeDiUm';
  const result = normSize(input);
  assert.equal(result, "M");
});

test('maps x-large alias to XL', () => {
  const input = 'x-large';
  const result = normSize(input);
  assert.equal(result, "XL");
});

test('returns canonical size when input is already uppercase', () => {
  const input = 'L';
  const result = normSize(input);
  assert.equal(result, "L");
});

test('returns undetermined for unknown string', () => {
  const input = 'huge';
  const result = normSize(input);
  assert.equal(result, "undetermined");
});

test('returns undetermined for null input', () => {
  const input = null;
  const result = normSize(input);
  assert.equal(result, "undetermined");
});

test('returns undetermined for empty string', () => {
  const input = '';
  const result = normSize(input);
  assert.equal(result, "undetermined");
});

test('returns undetermined for number input', () => {
  const input = 42;
  const result = normSize(input);
  assert.equal(result, "undetermined");
});
