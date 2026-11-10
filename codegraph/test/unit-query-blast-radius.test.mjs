// Computes the set of modules that import a given path, up to a depth limit (codegraph/query.mjs blastRadius).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blastRadius } from '../query.mjs';

test('returns empty reached when no modules import the root', () => {
  const g = { nodes: [{ id: 'mod:a', kind: 'module' }], edges: [], files: {} };
  assert.deepEqual(blastRadius(g, 'a'), { root: "a", reached: [], lowerBound: false, unknownFrom: [] });
});

test('reaches direct importers at depth 1', () => {
  const g = {
    nodes: [
      { id: 'mod:a', kind: 'module' },
      { id: 'mod:b', kind: 'module' },
    ],
    edges: [{ kind: 'imports', from: 'mod:b', to: 'mod:a' }],
    files: {},
  };
  assert.deepEqual(blastRadius(g, 'a'), { root: "a", reached: [{ path: "b", depth: 1 }], lowerBound: false, unknownFrom: [] });
});

test('reaches transitive importers at depth 2', () => {
  const g = {
    nodes: [
      { id: 'mod:a', kind: 'module' },
      { id: 'mod:b', kind: 'module' },
      { id: 'mod:c', kind: 'module' },
    ],
    edges: [
      { kind: 'imports', from: 'mod:b', to: 'mod:a' },
      { kind: 'imports', from: 'mod:c', to: 'mod:b' },
    ],
    files: {},
  };
  assert.deepEqual(blastRadius(g, 'a'), { root: "a", reached: [{ path: "b", depth: 1 }, { path: "c", depth: 2 }], lowerBound: false, unknownFrom: [] });
});

test('stops at maxDepth 1 excluding depth 2 importers', () => {
  const g = {
    nodes: [
      { id: 'mod:a', kind: 'module' },
      { id: 'mod:b', kind: 'module' },
      { id: 'mod:c', kind: 'module' },
    ],
    edges: [
      { kind: 'imports', from: 'mod:b', to: 'mod:a' },
      { kind: 'imports', from: 'mod:c', to: 'mod:b' },
    ],
    files: {},
  };
  assert.deepEqual(blastRadius(g, 'a', { maxDepth: 1 }), { root: "a", reached: [{ path: "b", depth: 1 }], lowerBound: false, unknownFrom: [] });
});

test('includes unreadable files in unknownFrom and sets lowerBound true', () => {
  const g = {
    nodes: [{ id: 'mod:a', kind: 'module' }],
    edges: [],
    files: { unreadable: [{ path: 'x.js', reason: 'ENOENT' }] },
  };
  assert.deepEqual(blastRadius(g, 'a'), { root: "a", reached: [], lowerBound: true, unknownFrom: [{ path: "x.js", reason: "ENOENT" }] });
});

test('sets lowerBound false when no unreadable files', () => {
  const g = {
    nodes: [
      { id: 'mod:a', kind: 'module' },
      { id: 'mod:b', kind: 'module' },
    ],
    edges: [{ kind: 'imports', from: 'mod:b', to: 'mod:a' }],
    files: {},
  };
  assert.deepEqual(blastRadius(g, 'a'), { root: "a", reached: [{ path: "b", depth: 1 }], lowerBound: false, unknownFrom: [] });
});

test('sorts reached by depth then path alphabetically', () => {
  const g = {
    nodes: [
      { id: 'mod:a', kind: 'module' },
      { id: 'mod:z', kind: 'module' },
      { id: 'mod:m', kind: 'module' },
      { id: 'mod:b', kind: 'module' },
    ],
    edges: [
      { kind: 'imports', from: 'mod:z', to: 'mod:a' },
      { kind: 'imports', from: 'mod:m', to: 'mod:a' },
      { kind: 'imports', from: 'mod:b', to: 'mod:a' },
    ],
    files: {},
  };
  assert.deepEqual(blastRadius(g, 'a'), { root: "a", reached: [{ path: "b", depth: 1 }, { path: "m", depth: 1 }, { path: "z", depth: 1 }], lowerBound: false, unknownFrom: [] });
});

test('deduplicates importers reached via multiple paths', () => {
  const g = {
    nodes: [
      { id: 'mod:a', kind: 'module' },
      { id: 'mod:b', kind: 'module' },
      { id: 'mod:c', kind: 'module' },
    ],
    edges: [
      { kind: 'imports', from: 'mod:b', to: 'mod:a' },
      { kind: 'imports', from: 'mod:c', to: 'mod:a' },
      { kind: 'imports', from: 'mod:c', to: 'mod:b' },
    ],
    files: {},
  };
  assert.deepEqual(blastRadius(g, 'a'), { root: "a", reached: [{ path: "b", depth: 1 }, { path: "c", depth: 1 }], lowerBound: false, unknownFrom: [] });
});
