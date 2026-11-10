// Extracts the area suffix from a sweep batch name (monitor/lane-timing.mjs batchArea).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchArea } from '../lane-timing.mjs';

test('returns the area suffix for a valid batch name', () => {
  const r = batchArea('sweep-20240101120000-alpha');
  assert.equal(r, "alpha");
});

test('returns null for an empty string', () => {
  const r = batchArea('');
  assert.equal(r, null);
});

test('returns null for undefined input', () => {
  const r = batchArea(undefined);
  assert.equal(r, null);
});

test('returns null for null input', () => {
  const r = batchArea(null);
  assert.equal(r, null);
});

test('returns null for a name that does not match the pattern', () => {
  const r = batchArea('sweep-20240101120000');
  assert.equal(r, null);
});

test('returns null for a name with a short timestamp', () => {
  const r = batchArea('sweep-202401011200-alpha');
  assert.equal(r, null);
});

test('returns null for a name with a long timestamp', () => {
  const r = batchArea('sweep-202401011200001-alpha');
  assert.equal(r, null);
});

test('returns the area suffix for a name with a long area', () => {
  const r = batchArea('sweep-20240101120000-' + 'x'.repeat(100));
  assert.equal(r, "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
});
