// flow/test/graph-units.test.mjs — case tests for artifactKinds, edgeKey, mergeEdges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { artifactKinds, edgeKey, mergeEdges } from '../graph.mjs';

test('returns empty Map for no paths', () => {
  const result = artifactKinds([], []);
  assert.deepEqual(result, new Map());
});

test('path written and read is store', () => {
  const paths = ['a.txt'];
  const edges = [
    { kind: 'writes', target: 'a.txt' },
    { kind: 'reads', target: 'a.txt' },
  ];
  const result = artifactKinds(paths, edges);
  assert.equal(result.get('a.txt'), 'store');
});

test('path written only is artifact', () => {
  const paths = ['b.txt'];
  const edges = [{ kind: 'writes', target: 'b.txt' }];
  const result = artifactKinds(paths, edges);
  assert.equal(result.get('b.txt'), 'artifact');
});

test('path read only is artifact', () => {
  const paths = ['c.txt'];
  const edges = [{ kind: 'reads', target: 'c.txt' }];
  const result = artifactKinds(paths, edges);
  assert.equal(result.get('c.txt'), 'artifact');
});

test('path with no edges is artifact', () => {
  const paths = ['d.txt'];
  const result = artifactKinds(paths, []);
  assert.equal(result.get('d.txt'), 'artifact');
});

test('multiple paths with mixed kinds', () => {
  const paths = ['x', 'y', 'z'];
  const edges = [
    { kind: 'writes', target: 'x' },
    { kind: 'reads', target: 'x' },
    { kind: 'writes', target: 'y' },
    { kind: 'reads', target: 'z' },
  ];
  const result = artifactKinds(paths, edges);
  assert.equal(result.get('x'), 'store');
  assert.equal(result.get('y'), 'artifact');
  assert.equal(result.get('z'), 'artifact');
});

test('ignores non-writes/reads edge kinds', () => {
  const paths = ['e.txt'];
  const edges = [
    { kind: 'spawns', target: 'e.txt' },
    { kind: 'touches', target: 'e.txt' },
  ];
  const result = artifactKinds(paths, edges);
  assert.equal(result.get('e.txt'), 'artifact');
});

test('duplicate writes/reads edges still store', () => {
  const paths = ['f.txt'];
  const edges = [
    { kind: 'writes', target: 'f.txt' },
    { kind: 'writes', target: 'f.txt' },
    { kind: 'reads', target: 'f.txt' },
    { kind: 'reads', target: 'f.txt' },
  ];
  const result = artifactKinds(paths, edges);
  assert.equal(result.get('f.txt'), 'store');
});

test('edgeKey returns JSON string of [from, to, kind]', () => {
  const result = edgeKey('a', 'b', 'reads');
  assert.equal(result, '["a","b","reads"]');
});

test('edgeKey with different kinds produces different keys', () => {
  const k1 = edgeKey('a', 'b', 'reads');
  const k2 = edgeKey('a', 'b', 'writes');
  assert.notEqual(k1, k2);
  assert.equal(k1, '["a","b","reads"]');
  assert.equal(k2, '["a","b","writes"]');
});

test('edgeKey with swapped from/to produces different key', () => {
  const k1 = edgeKey('a', 'b', 'reads');
  const k2 = edgeKey('b', 'a', 'reads');
  assert.notEqual(k1, k2);
  assert.equal(k1, '["a","b","reads"]');
  assert.equal(k2, '["b","a","reads"]');
});

test('edgeKey with same from and to', () => {
  const result = edgeKey('x', 'x', 'touches');
  assert.equal(result, '["x","x","touches"]');
});

test('edgeKey with empty strings', () => {
  const result = edgeKey('', '', 'spawns');
  assert.equal(result, '["","","spawns"]');
});

test('edgeKey with special characters in values', () => {
  const result = edgeKey('a"b', 'c\\d', 'reads');
  assert.equal(result, '["a\\"b","c\\\\d","reads"]');
});

test('edgeKey is deterministic for same inputs', () => {
  const k1 = edgeKey('m1', 'm2', 'writes');
  const k2 = edgeKey('m1', 'm2', 'writes');
  assert.equal(k1, k2);
});

test('empty input returns empty array', () => {
  assert.deepEqual(mergeEdges([]), []);
});

test('single edge returns it with evidence as array', () => {
  const e = { from: 'a', to: 'b', kind: 'reads', witness: 'static', existence: 'unknown', evidence: 'x:1' };
  const out = mergeEdges([e]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].evidence, ['x:1']);
});

test('duplicate identity accumulates evidence without replacement', () => {
  const e1 = { from: 'a', to: 'b', kind: 'reads', witness: 'static', existence: 'unknown', evidence: 'x:1' };
  const e2 = { from: 'a', to: 'b', kind: 'reads', witness: 'runtime', existence: 'confirmed', evidence: 'y:2' };
  const out = mergeEdges([e1, e2]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].evidence, ['x:1', 'y:2']);
});

test('duplicate identity with same evidence does not duplicate', () => {
  const e1 = { from: 'a', to: 'b', kind: 'reads', witness: 'static', existence: 'unknown', evidence: 'x:1' };
  const e2 = { from: 'a', to: 'b', kind: 'reads', witness: 'static', existence: 'unknown', evidence: 'x:1' };
  const out = mergeEdges([e1, e2]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].evidence, ['x:1']);
});

test('different kind is a different edge', () => {
  const e1 = { from: 'a', to: 'b', kind: 'reads', witness: 'static', existence: 'unknown', evidence: null };
  const e2 = { from: 'a', to: 'b', kind: 'writes', witness: 'static', existence: 'unknown', evidence: null };
  const out = mergeEdges([e1, e2]);
  assert.equal(out.length, 2);
});

test('null evidence becomes empty array', () => {
  const e = { from: 'a', to: 'b', kind: 'reads', witness: 'static', existence: 'unknown', evidence: null };
  const out = mergeEdges([e]);
  assert.deepEqual(out[0].evidence, []);
});

test('output is sorted by edgeKey', () => {
  const e1 = { from: 'b', to: 'c', kind: 'reads', witness: 'static', existence: 'unknown', evidence: null };
  const e2 = { from: 'a', to: 'b', kind: 'reads', witness: 'static', existence: 'unknown', evidence: null };
  const out = mergeEdges([e1, e2]);
  assert.equal(out[0].from, 'a');
  assert.equal(out[1].from, 'b');
});
