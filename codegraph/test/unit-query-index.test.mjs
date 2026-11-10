// computes various index maps from a code graph (codegraph/query.mjs index).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { index } from '../query.mjs';

test('byId maps node ids to nodes', () => {
  const graph = {
    nodes: [{ id: 'n1', kind: 'symbol' }, { id: 'n2', kind: 'module' }],
    edges: []
  };
  const r = index(graph);
  assert.deepEqual(r.byId.get('n1'), { id: "n1", kind: "symbol" });
  assert.deepEqual(r.byId.get('n2'), { id: "n2", kind: "module" });
});

test('importsOut accumulates multiple edges with same from key', () => {
  const graph = {
    nodes: [{ id: 'mod:a', kind: 'module' }, { id: 'mod:b', kind: 'module' }],
    edges: [
      { kind: 'imports', from: 'mod:a', to: 'mod:b' },
      { kind: 'imports', from: 'mod:a', to: 'mod:b' }
    ]
  };
  const r = index(graph);
  assert.deepEqual(r.importsOut.get('mod:a')[0], { kind: "imports", from: "mod:a", to: "mod:b" });
  assert.deepEqual(r.importsOut.get('mod:a')[1], { kind: "imports", from: "mod:a", to: "mod:b" });
});

test('reexports handling of star vs specific symbol', () => {
  const graph = {
    nodes: [{ id: 'mod:x', kind: 'module' }, { id: 'sym:y#z', kind: 'symbol' }],
    edges: [
      { kind: 'reexports', from: 'mod:x', to: 'sym:y#z', star: true },
      { kind: 'reexports', from: 'mod:x', to: 'sym:y#z', star: false }
    ]
  };
  const r = index(graph);
  assert.deepEqual(r.reexportsFrom.get('mod:x')[0], { kind: "reexports", from: "mod:x", to: "sym:y#z", star: true });
  assert.deepEqual(r.reexportsFrom.get('mod:x')[1], { kind: "reexports", from: "mod:x", to: "sym:y#z", star: false });
  assert.deepEqual(r.reexportsOf.get('x')[0], { kind: "reexports", from: "mod:x", to: "sym:y#z", star: true });
  assert.deepEqual(r?.reexportsOf?.get('y')?.[0], undefined);
});

test('exportedOf includes exported symbols', () => {
  const graph = {
    nodes: [{ id: 'sym:a#b', kind: 'symbol', path: 'a', exported: true }],
    edges: []
  };
  const r = index(graph);
  assert.deepEqual(r.exportedOf.get('a'), [{ id: "sym:a#b", kind: "symbol", path: "a", exported: true }]);
});

test('exportedOf does not include exported non\u2011symbol nodes', () => {
  const graph = {
    nodes: [{ id: 'mod:c', kind: 'module', path: 'c', exported: true }],
    edges: []
  };
  const r = index(graph);
  assert.equal(r.exportedOf.get('c'), undefined);
});

test('exportedOf does not include non\u2011exported symbols', () => {
  const graph = {
    nodes: [{ id: 'sym:d#e', kind: 'symbol', path: 'd', exported: false }],
    edges: []
  };
  const r = index(graph);
  assert.equal(r.exportedOf.get('d'), undefined);
});
