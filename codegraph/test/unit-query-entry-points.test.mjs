// Returns sorted paths of module nodes that are not imported by any other node (codegraph/query.mjs entryPoints).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryPoints } from '../query.mjs';

test('returns empty array when graph has no nodes', () => {
  const graph = { nodes: [], edges: [] };
  assert.deepEqual(entryPoints(graph), []);
});

test('returns path of a module node that is not imported', () => {
  const graph = {
    nodes: [
      { id: 'mod:a', kind: 'module', path: 'a' },
      { id: 'mod:b', kind: 'module', path: 'b' }
    ],
    edges: [
      { kind: 'imports', from: 'mod:b', to: 'mod:a' }
    ]
  };
  assert.deepEqual(entryPoints(graph), ["b"]);
});

test('excludes module nodes that are imported by other nodes', () => {
  const graph = {
    nodes: [
      { id: 'mod:a', kind: 'module', path: 'a' },
      { id: 'mod:b', kind: 'module', path: 'b' },
      { id: 'mod:c', kind: 'module', path: 'c' }
    ],
    edges: [
      { kind: 'imports', from: 'mod:b', to: 'mod:a' },
      { kind: 'imports', from: 'mod:c', to: 'mod:a' }
    ]
  };
  assert.deepEqual(entryPoints(graph), ["b", "c"]);
});

test('includes non-module nodes that are not imported', () => {
  const graph = {
    nodes: [
      { id: 'mod:a', kind: 'module', path: 'a' },
      { id: 'sym:x', kind: 'symbol', path: 'a#x' }
    ],
    edges: []
  };
  assert.deepEqual(entryPoints(graph), ["a"]);
});

test('excludes non-module nodes that are imported', () => {
  const graph = {
    nodes: [
      { id: 'mod:a', kind: 'module', path: 'a' },
      { id: 'sym:x', kind: 'symbol', path: 'a#x' }
    ],
    edges: [
      { kind: 'imports', from: 'mod:a', to: 'sym:x' }
    ]
  };
  assert.deepEqual(entryPoints(graph), ["a"]);
});

test('returns sorted paths when multiple modules are entry points', () => {
  const graph = {
    nodes: [
      { id: 'mod:c', kind: 'module', path: 'c' },
      { id: 'mod:a', kind: 'module', path: 'a' },
      { id: 'mod:b', kind: 'module', path: 'b' }
    ],
    edges: []
  };
  assert.deepEqual(entryPoints(graph), ["a", "b", "c"]);
});

test('handles module with multiple incoming imports', () => {
  const graph = {
    nodes: [
      { id: 'mod:a', kind: 'module', path: 'a' },
      { id: 'mod:b', kind: 'module', path: 'b' },
      { id: 'mod:c', kind: 'module', path: 'c' }
    ],
    edges: [
      { kind: 'imports', from: 'mod:b', to: 'mod:a' },
      { kind: 'imports', from: 'mod:c', to: 'mod:a' },
      { kind: 'imports', from: 'mod:b', to: 'mod:c' }
    ]
  };
  assert.deepEqual(entryPoints(graph), ["b"]);
});

test('returns all module paths when no import edges exist', () => {
  const graph = {
    nodes: [
      { id: 'mod:z', kind: 'module', path: 'z' },
      { id: 'mod:y', kind: 'module', path: 'y' },
      { id: 'mod:x', kind: 'module', path: 'x' }
    ],
    edges: []
  };
  assert.deepEqual(entryPoints(graph), ["x", "y", "z"]);
});
