// Resolves the durable-write byte limit from CW_DURABLE_MAX_BYTES (lib/durable-write.mjs maxBytes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maxBytes } from '../durable-write.mjs';

test('returns the configured value when CW_DURABLE_MAX_BYTES is a positive number', () => {
  const r = maxBytes({ CW_DURABLE_MAX_BYTES: '1234' });
  assert.equal(r, 1234);
});

test('returns the default when CW_DURABLE_MAX_BYTES is zero', () => {
  const r = maxBytes({ CW_DURABLE_MAX_BYTES: '0' });
  assert.equal(r, 67108864);
});

test('returns the default when CW_DURABLE_MAX_BYTES is negative', () => {
  const r = maxBytes({ CW_DURABLE_MAX_BYTES: '-1' });
  assert.equal(r, 67108864);
});

test('returns the default when CW_DURABLE_MAX_BYTES is NaN', () => {
  const r = maxBytes({ CW_DURABLE_MAX_BYTES: 'abc' });
  assert.equal(r, 67108864);
});

test('returns the default when CW_DURABLE_MAX_BYTES is Infinity', () => {
  const r = maxBytes({ CW_DURABLE_MAX_BYTES: 'Infinity' });
  assert.equal(r, 67108864);
});

test('returns the default when CW_DURABLE_MAX_BYTES is missing', () => {
  const r = maxBytes({});
  assert.equal(r, 67108864);
});

test('returns the configured value when CW_DURABLE_MAX_BYTES is one', () => {
  const r = maxBytes({ CW_DURABLE_MAX_BYTES: '1' });
  assert.equal(r, 1);
});

test('returns the default when CW_DURABLE_MAX_BYTES is a very large finite number', () => {
  const r = maxBytes({ CW_DURABLE_MAX_BYTES: String(64 * 1024 * 1024) });
  assert.equal(r, 67108864);
});
