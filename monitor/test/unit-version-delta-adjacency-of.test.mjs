// Computes the registry-publish-order relation between two version strings (monitor/version-delta.mjs adjacencyOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjacencyOf } from '../version-delta.mjs';

test('returns republish with window 0 when versions are identical', () => {
  const result = adjacencyOf('1.0.0', '1.0.0', ['1.0.0', '1.0.1']);
  assert.deepEqual(result, { relation: 'republish', window: 0 });
});

test('returns unordered with null window when order is not an array', () => {
  const result = adjacencyOf('1.0.0', '1.0.1', null);
  assert.deepEqual(result, { relation: 'unordered', window: null });
});

test('returns unordered with null window when order is undefined', () => {
  const result = adjacencyOf('1.0.0', '1.0.1', undefined);
  assert.deepEqual(result, { relation: 'unordered', window: null });
});

test('returns unordered with null window when prev version is not in order', () => {
  const result = adjacencyOf('9.9.9', '1.0.1', ['1.0.0', '1.0.1']);
  assert.deepEqual(result, { relation: 'unordered', window: null });
});

test('returns unordered with null window when curr version is not in order', () => {
  const result = adjacencyOf('1.0.0', '9.9.9', ['1.0.0', '1.0.1']);
  assert.deepEqual(result, { relation: 'unordered', window: null });
});

test('returns adjacent with window 1 when curr is exactly one step after prev', () => {
  const result = adjacencyOf('1.0.0', '1.0.1', ['1.0.0', '1.0.1', '1.0.2']);
  assert.deepEqual(result, { relation: 'adjacent', window: 1 });
});

test('returns window with span 2 when curr is two steps after prev', () => {
  const result = adjacencyOf('1.0.0', '1.0.2', ['1.0.0', '1.0.1', '1.0.2']);
  assert.deepEqual(result, { relation: 'window', window: 2 });
});

test('returns window with span 3 when curr is three steps after prev', () => {
  const result = adjacencyOf('1.0.0', '1.0.3', ['1.0.0', '1.0.1', '1.0.2', '1.0.3']);
  assert.deepEqual(result, { relation: 'window', window: 3 });
});

test('returns regressed with window -1 when curr precedes prev by one step', () => {
  const result = adjacencyOf('1.0.1', '1.0.0', ['1.0.0', '1.0.1']);
  assert.deepEqual(result, { relation: 'regressed', window: -1 });
});

test('returns regressed with window -2 when curr precedes prev by two steps', () => {
  const result = adjacencyOf('1.0.2', '1.0.0', ['1.0.0', '1.0.1', '1.0.2']);
  assert.deepEqual(result, { relation: 'regressed', window: -2 });
});
