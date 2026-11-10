// Maps each repo to the newest slice covering it (monitor/area-coverage.mjs newestPerRepo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newestPerRepo } from '../area-coverage.mjs';

test('returns an empty object when there are no slices', () => {
  assert.deepEqual(newestPerRepo([]), {});
});

test('keeps the first slice when a later slice has an older timestamp', () => {
  const slices = [
    { sliceId: 's1', generated: 200, file: 'f1', repos: ['r'] },
    { sliceId: 's2', generated: 100, file: 'f2', repos: ['r'] },
  ];
  assert.deepEqual(newestPerRepo(slices), { r: { sliceId: "s1", generated: 200, file: "f1" } });
});

test('replaces the first slice when a later slice has a newer timestamp', () => {
  const slices = [
    { sliceId: 's1', generated: 100, file: 'f1', repos: ['r'] },
    { sliceId: 's2', generated: 200, file: 'f2', repos: ['r'] },
  ];
  assert.deepEqual(newestPerRepo(slices), { r: { sliceId: "s2", generated: 200, file: "f2" } });
});

test('keeps the first slice when both slices have equal timestamps', () => {
  const slices = [
    { sliceId: 's1', generated: 100, file: 'f1', repos: ['r'] },
    { sliceId: 's2', generated: 100, file: 'f2', repos: ['r'] },
  ];
  assert.deepEqual(newestPerRepo(slices), { r: { sliceId: "s1", generated: 100, file: "f1" } });
});

test('replaces a slice without a timestamp when the later slice has one', () => {
  const slices = [
    { sliceId: 's1', generated: null, file: 'f1', repos: ['r'] },
    { sliceId: 's2', generated: 100, file: 'f2', repos: ['r'] },
  ];
  assert.deepEqual(newestPerRepo(slices), { r: { sliceId: "s2", generated: 100, file: "f2" } });
});

test('keeps the first slice when the later slice has no timestamp', () => {
  const slices = [
    { sliceId: 's1', generated: 100, file: 'f1', repos: ['r'] },
    { sliceId: 's2', generated: null, file: 'f2', repos: ['r'] },
  ];
  assert.deepEqual(newestPerRepo(slices), { r: { sliceId: "s1", generated: 100, file: "f1" } });
});

test('keeps the first slice when both slices lack timestamps', () => {
  const slices = [
    { sliceId: 's1', generated: null, file: 'f1', repos: ['r'] },
    { sliceId: 's2', generated: null, file: 'f2', repos: ['r'] },
  ];
  assert.deepEqual(newestPerRepo(slices), { r: { sliceId: "s1", generated: null, file: "f1" } });
});

test('tracks each repo independently across multiple repos', () => {
  const slices = [
    { sliceId: 's1', generated: 100, file: 'f1', repos: ['a', 'b'] },
    { sliceId: 's2', generated: 200, file: 'f2', repos: ['a'] },
  ];
  assert.deepEqual(newestPerRepo(slices), { a: { sliceId: "s2", generated: 200, file: "f2" }, b: { sliceId: "s1", generated: 100, file: "f1" } });
});
