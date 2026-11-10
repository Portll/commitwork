// Returns the configured maximum content size in bytes, defaulting to a measured constant (lib/memory-layer-client.mjs contentMaxBytes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentMaxBytes } from '../memory-layer-client.mjs';

test('returns the floor of a positive finite number from env', () => {
  const input = { env: { CW_VELD_CONTENT_MAX: '123.7' } };
  const result = contentMaxBytes(input);
  assert.equal(result, 123);
});

test('returns the default constant when env value is zero', () => {
  const input = { env: { CW_VELD_CONTENT_MAX: '0' } };
  const result = contentMaxBytes(input);
  assert.equal(result, 50000);
});

test('returns the default constant when env value is negative', () => {
  const input = { env: { CW_VELD_CONTENT_MAX: '-5' } };
  const result = contentMaxBytes(input);
  assert.equal(result, 50000);
});

test('returns the default constant when env value is non-numeric', () => {
  const input = { env: { CW_VELD_CONTENT_MAX: 'abc' } };
  const result = contentMaxBytes(input);
  assert.equal(result, 50000);
});

test('returns the default constant when env value is NaN', () => {
  const input = { env: { CW_VELD_CONTENT_MAX: 'NaN' } };
  const result = contentMaxBytes(input);
  assert.equal(result, 50000);
});

test('returns the default constant when env value is Infinity', () => {
  const input = { env: { CW_VELD_CONTENT_MAX: 'Infinity' } };
  const result = contentMaxBytes(input);
  assert.equal(result, 50000);
});

test('returns the default constant when env value is one', () => {
  const input = { env: { CW_VELD_CONTENT_MAX: '1' } };
  const result = contentMaxBytes(input);
  assert.equal(result, 1);
});

test('returns the floor of a positive integer string from env', () => {
  const input = { env: { CW_VELD_CONTENT_MAX: '100' } };
  const result = contentMaxBytes(input);
  assert.equal(result, 100);
});
