// Computes which test names appeared, cleared, or persist between two runs (bin/lib/new-since-last.mjs newSinceLast).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSinceLast } from '../lib/new-since-last.mjs';

test('filters non-string and blank entries from current and deduplicates', () => {
  const r = newSinceLast(['a'], ['a', 'a', 'b', '', '  ', 42, null, undefined]);
  assert.deepEqual(r, { status: "compared", appeared: ["b"], cleared: [], clearedUnknown: [], persisting: ["a"], grew: false, shrank: false, delta: null });
});

test('returns no-baseline shape when previous is not an array', () => {
  const r = newSinceLast(null, ['x', 'y']);
  assert.deepEqual(r, { status: "no-baseline", appeared: [], cleared: [], clearedUnknown: [], persisting: ["x", "y"], grew: false, shrank: false });
});

test('returns no-baseline shape when previous is undefined', () => {
  const r = newSinceLast(undefined, ['z']);
  assert.deepEqual(r, { status: "no-baseline", appeared: [], cleared: [], clearedUnknown: [], persisting: ["z"], grew: false, shrank: false });
});

test('reports grew true and shrank false when tests exceed prevTests', () => {
  const r = newSinceLast(['a'], ['a'], { prevTests: 10, tests: 20 });
  assert.deepEqual(r, { status: "compared", appeared: [], cleared: [], clearedUnknown: [], persisting: ["a"], grew: true, shrank: false, delta: 10 });
});

test('reports grew false and shrank true when tests are less than prevTests', () => {
  const r = newSinceLast(['a', 'b'], ['a'], { prevTests: 20, tests: 10 });
  assert.deepEqual(r, { status: "compared", appeared: [], cleared: [], clearedUnknown: ["b"], persisting: ["a"], grew: false, shrank: true, delta: -10 });
});

test('reports grew false and shrank false when tests equal prevTests', () => {
  const r = newSinceLast(['a'], ['a'], { prevTests: 10, tests: 10 });
  assert.deepEqual(r, { status: "compared", appeared: [], cleared: [], clearedUnknown: [], persisting: ["a"], grew: false, shrank: false, delta: 0 });
});

test('reports grew false and shrank false when only one count is provided', () => {
  const r = newSinceLast(['a'], ['a'], { prevTests: 10 });
  assert.deepEqual(r, { status: "compared", appeared: [], cleared: [], clearedUnknown: [], persisting: ["a"], grew: false, shrank: false, delta: null });
});

test('reports grew false and shrank false when no counts are provided', () => {
  const r = newSinceLast(['a'], ['a']);
  assert.deepEqual(r, { status: "compared", appeared: [], cleared: [], clearedUnknown: [], persisting: ["a"], grew: false, shrank: false, delta: null });
});

test('reports grew false and shrank false when only tests count is provided', () => {
  const r = newSinceLast(['a'], ['a'], { tests: 10 });
  assert.deepEqual(r, { status: "compared", appeared: [], cleared: [], clearedUnknown: [], persisting: ["a"], grew: false, shrank: false, delta: null });
});

test('moves cleared names to clearedUnknown when shrank is true', () => {
  const r = newSinceLast(['a', 'b'], ['a'], { prevTests: 20, tests: 10 });
  assert.deepEqual(r, { status: "compared", appeared: [], cleared: [], clearedUnknown: ["b"], persisting: ["a"], grew: false, shrank: true, delta: -10 });
});
