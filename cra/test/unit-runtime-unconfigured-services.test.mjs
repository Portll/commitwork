// Names in the scanned set that are absent from the configured targets (cra/runtime.mjs unconfiguredServices).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unconfiguredServices } from '../runtime.mjs';

test('returns empty array when both inputs are empty arrays', () => {
  const result = unconfiguredServices([], []);
  assert.deepEqual(result, []);
});

test('returns all scanned names when targets is empty', () => {
  const result = unconfiguredServices(['svc-a', 'svc-b'], []);
  assert.deepEqual(result, ['svc-a', 'svc-b']);
});

test('returns empty array when all scanned names are configured', () => {
  const result = unconfiguredServices(['svc-a', 'svc-b'], [
    { name: 'svc-a' },
    { name: 'svc-b' }
  ]);
  assert.deepEqual(result, []);
});

test('returns only the unconfigured scanned names', () => {
  const result = unconfiguredServices(['svc-a', 'svc-b', 'svc-c'], [
    { name: 'svc-a' },
    { name: 'svc-c' }
  ]);
  assert.deepEqual(result, ['svc-b']);
});

test('returns all scanned names when targets is null', () => {
  const result = unconfiguredServices(['svc-a', 'svc-b'], null);
  assert.deepEqual(result, ['svc-a', 'svc-b']);
});

test('returns all scanned names when targets is undefined', () => {
  const result = unconfiguredServices(['svc-a', 'svc-b'], undefined);
  assert.deepEqual(result, ['svc-a', 'svc-b']);
});

test('returns empty array when scannedNames is null', () => {
  const result = unconfiguredServices(null, [{ name: 'svc-a' }]);
  assert.deepEqual(result, []);
});

test('returns empty array when scannedNames is undefined', () => {
  const result = unconfiguredServices(undefined, [{ name: 'svc-a' }]);
  assert.deepEqual(result, []);
});

test('handles duplicate names in scannedNames correctly', () => {
  const result = unconfiguredServices(['svc-a', 'svc-a', 'svc-b'], [
    { name: 'svc-a' }
  ]);
  assert.deepEqual(result, ['svc-b']);
});

test('handles duplicate names in targets correctly', () => {
  const result = unconfiguredServices(['svc-a', 'svc-b'], [
    { name: 'svc-a' },
    { name: 'svc-a' }
  ]);
  assert.deepEqual(result, ['svc-b']);
});
