// Classifies each path as store or artifact based on read and write edges (flow/graph.mjs artifactKinds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artifactKinds } from '../graph.mjs';

test('returns empty map when there are no paths', () => {
  const r = artifactKinds([], []);
  assert.deepEqual(r, new Map([]));
});

test('classifies a path written and read as store', () => {
  const r = artifactKinds(['a'], [
    { kind: 'writes', target: 'a' },
    { kind: 'reads', target: 'a' }
  ]);
  assert.deepEqual(r, new Map([["a", "store"]]));
});

test('classifies a path only written as artifact', () => {
  const r = artifactKinds(['a'], [
    { kind: 'writes', target: 'a' }
  ]);
  assert.deepEqual(r, new Map([["a", "artifact"]]));
});

test('classifies a path only read as artifact', () => {
  const r = artifactKinds(['a'], [
    { kind: 'reads', target: 'a' }
  ]);
  assert.deepEqual(r, new Map([["a", "artifact"]]));
});

test('classifies a path with no edges as artifact', () => {
  const r = artifactKinds(['a'], []);
  assert.deepEqual(r, new Map([["a", "artifact"]]));
});

test('ignores edges with other kinds when classifying', () => {
  const r = artifactKinds(['a'], [
    { kind: 'deletes', target: 'a' },
    { kind: 'moves', target: 'a' }
  ]);
  assert.deepEqual(r, new Map([["a", "artifact"]]));
});

test('classifies multiple paths with mixed edge kinds', () => {
  const r = artifactKinds(['a', 'b', 'c'], [
    { kind: 'writes', target: 'a' },
    { kind: 'reads', target: 'a' },
    { kind: 'writes', target: 'b' },
    { kind: 'reads', target: 'c' }
  ]);
  assert.deepEqual(r, new Map([["a", "store"], ["b", "artifact"], ["c", "artifact"]]));
});

test('handles duplicate edges for the same target', () => {
  const r = artifactKinds(['a'], [
    { kind: 'writes', target: 'a' },
    { kind: 'writes', target: 'a' },
    { kind: 'reads', target: 'a' },
    { kind: 'reads', target: 'a' }
  ]);
  assert.deepEqual(r, new Map([["a", "store"]]));
});
