// Computes the durable-write headroom in bytes from CW_DURABLE_HEADROOM_BYTES (lib/durable-write.mjs headroomBytes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headroomBytes } from '../durable-write.mjs';

test('returns the parsed value when CW_DURABLE_HEADROOM_BYTES is a positive number', () => {
  const r = headroomBytes({ CW_DURABLE_HEADROOM_BYTES: '1024' });
  assert.equal(r, 1024);
});

test('returns the parsed value when CW_DURABLE_HEADROOM_BYTES is zero', () => {
  const r = headroomBytes({ CW_DURABLE_HEADROOM_BYTES: '0' });
  assert.equal(r, 0);
});

test('returns the parsed value when CW_DURABLE_HEADROOM_BYTES is a negative number', () => {
  const r = headroomBytes({ CW_DURABLE_HEADROOM_BYTES: '-1' });
  assert.equal(r, 8388608);
});

test('returns the parsed value when CW_DURABLE_HEADROOM_BYTES is a non-numeric string', () => {
  const r = headroomBytes({ CW_DURABLE_HEADROOM_BYTES: 'abc' });
  assert.equal(r, 8388608);
});

test('returns the parsed value when CW_DURABLE_HEADROOM_BYTES is an empty string', () => {
  const r = headroomBytes({ CW_DURABLE_HEADROOM_BYTES: '' });
  assert.equal(r, 0);
});

test('returns the parsed value when CW_DURABLE_HEADROOM_BYTES is the string Infinity', () => {
  const r = headroomBytes({ CW_DURABLE_HEADROOM_BYTES: 'Infinity' });
  assert.equal(r, 8388608);
});

test('returns the parsed value when CW_DURABLE_HEADROOM_BYTES is the string NaN', () => {
  const r = headroomBytes({ CW_DURABLE_HEADROOM_BYTES: 'NaN' });
  assert.equal(r, 8388608);
});

test('returns the parsed value when CW_DURABLE_HEADROOM_BYTES is the string -Infinity', () => {
  const r = headroomBytes({ CW_DURABLE_HEADROOM_BYTES: '-Infinity' });
  assert.equal(r, 8388608);
});

test('returns the parsed value when CW_DURABLE_HEADROOM_BYTES is a very large number', () => {
  const r = headroomBytes({ CW_DURABLE_HEADROOM_BYTES: '1e308' });
  assert.equal(r, 1e+308);
});

test('returns the parsed value when CW_DURABLE_HEADROOM_BYTES is a very small positive number', () => {
  const r = headroomBytes({ CW_DURABLE_HEADROOM_BYTES: '1e-308' });
  assert.equal(r, 1e-308);
});
