// Computes the set of nodes within a given depth of a root node in the graph (bin/graph.mjs neighbours).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neighbours } from '../graph.mjs';

const mkDb = (nodes, edges) => {
  const db = {
    _nodes: new Map(nodes.map((n) => [n.id, n])),
    _edges: edges,
    prepare(q) {
      return {
        get: (id) => {
          if (q.includes('FROM nodes')) return db._nodes.get(id) || null;
          return null;
        },
        all: (a, b) => {
          if (q.includes('FROM edges')) {
            if (b !== undefined) {
              const out = db._edges.filter((e) => e.src === a && e.rel === b);
              const inn = db._edges.filter((e) => e.dst === a && e.rel === b);
              return [...out, ...inn];
            }
            const out = db._edges.filter((e) => e.src === a);
            const inn = db._edges.filter((e) => e.dst === a);
            return [...out, ...inn];
          }
          return [];
        },
      };
    },
  };
  return db;
};

test('returns found false with reason when node is missing', () => {
  const db = mkDb([], []);
  const r = neighbours(db, 'missing');
  assert.deepEqual(r, { id: "missing", found: false, reason: "no node missing in the graph" });
});

test('returns found true with empty neighbours for isolated node', () => {
  const db = mkDb([{ id: 'a', kind: 'file', label: 'a' }], []);
  const r = neighbours(db, 'a');
  assert.deepEqual(r, { id: "a", found: true, node: { id: "a", kind: "file", label: "a" }, rel: null, depth: 1, count: 0, truncated: false, limit: 500, kinds: {}, neighbours: [] });
});

test('returns direct neighbours with correct depth and kinds', () => {
  const db = mkDb(
    [
      { id: 'a', kind: 'file', label: 'a' },
      { id: 'b', kind: 'file', label: 'b' },
      { id: 'c', kind: 'dir', label: 'c' },
    ],
    [
      { src: 'a', rel: 'imports', dst: 'b' },
      { src: 'a', rel: 'in', dst: 'c' },
    ]
  );
  const r = neighbours(db, 'a');
  assert.deepEqual(r, { id: "a", found: true, node: { id: "a", kind: "file", label: "a" }, rel: null, depth: 1, count: 2, truncated: false, limit: 500, kinds: { file: 1, dir: 1 }, neighbours: [{ id: "b", kind: "file", label: "b", rel: "imports", direction: "out", via: "a", distance: 1 }, { id: "c", kind: "dir", label: "c", rel: "in", direction: "out", via: "a", distance: 1 }] });
});

test('clamps depth to 1 when non-integer is provided', () => {
  const db = mkDb(
    [
      { id: 'a', kind: 'file', label: 'a' },
      { id: 'b', kind: 'file', label: 'b' },
      { id: 'c', kind: 'file', label: 'c' },
    ],
    [
      { src: 'a', rel: 'imports', dst: 'b' },
      { src: 'b', rel: 'imports', dst: 'c' },
    ]
  );
  const r = neighbours(db, 'a', { depth: 2.5 });
  assert.deepEqual(r, { id: "a", found: true, node: { id: "a", kind: "file", label: "a" }, rel: null, depth: 1, count: 1, truncated: false, limit: 500, kinds: { file: 1 }, neighbours: [{ id: "b", kind: "file", label: "b", rel: "imports", direction: "out", via: "a", distance: 1 }] });
});

test('clamps depth to MAX_DEPTH when exceeding it', () => {
  const db = mkDb(
    [
      { id: 'a', kind: 'file', label: 'a' },
      { id: 'b', kind: 'file', label: 'b' },
      { id: 'c', kind: 'file', label: 'c' },
      { id: 'd', kind: 'file', label: 'd' },
      { id: 'e', kind: 'file', label: 'e' },
    ],
    [
      { src: 'a', rel: 'imports', dst: 'b' },
      { src: 'b', rel: 'imports', dst: 'c' },
      { src: 'c', rel: 'imports', dst: 'd' },
      { src: 'd', rel: 'imports', dst: 'e' },
    ]
  );
  const r = neighbours(db, 'a', { depth: 10 });
  assert.deepEqual(r, { id: "a", found: true, node: { id: "a", kind: "file", label: "a" }, rel: null, depth: 4, count: 4, truncated: false, limit: 500, kinds: { file: 4 }, neighbours: [{ id: "b", kind: "file", label: "b", rel: "imports", direction: "out", via: "a", distance: 1 }, { id: "c", kind: "file", label: "c", rel: "imports", direction: "out", via: "b", distance: 2 }, { id: "d", kind: "file", label: "d", rel: "imports", direction: "out", via: "c", distance: 3 }, { id: "e", kind: "file", label: "e", rel: "imports", direction: "out", via: "d", distance: 4 }] });
});

test('truncates results when limit is reached', () => {
  const nodes = [
    { id: 'a', kind: 'file', label: 'a' },
    ...Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, kind: 'file', label: `n${i}` })),
  ];
  const edges = Array.from({ length: 5 }, (_, i) => ({ src: 'a', rel: 'imports', dst: `n${i}` }));
  const db = mkDb(nodes, edges);
  const r = neighbours(db, 'a', { limit: 3 });
  assert.deepEqual(r, { id: "a", found: true, node: { id: "a", kind: "file", label: "a" }, rel: null, depth: 1, count: 3, truncated: true, limit: 3, kinds: { file: 3 }, neighbours: [{ id: "n0", kind: "file", label: "n0", rel: "imports", direction: "out", via: "a", distance: 1 }, { id: "n1", kind: "file", label: "n1", rel: "imports", direction: "out", via: "a", distance: 1 }, { id: "n2", kind: "file", label: "n2", rel: "imports", direction: "out", via: "a", distance: 1 }] });
});

test('filters edges by rel when provided', () => {
  const db = mkDb(
    [
      { id: 'a', kind: 'file', label: 'a' },
      { id: 'b', kind: 'file', label: 'b' },
      { id: 'c', kind: 'dir', label: 'c' },
    ],
    [
      { src: 'a', rel: 'imports', dst: 'b' },
      { src: 'a', rel: 'in', dst: 'c' },
    ]
  );
  const r = neighbours(db, 'a', { rel: 'imports' });
  assert.deepEqual(r, { id: "a", found: true, node: { id: "a", kind: "file", label: "a" }, rel: "imports", depth: 1, count: 1, truncated: false, limit: 500, kinds: { file: 1 }, neighbours: [{ id: "b", kind: "file", label: "b", rel: "imports", direction: "out", via: "a", distance: 1 }] });
});

test('traverses multiple hops when depth exceeds 1', () => {
  const db = mkDb(
    [
      { id: 'a', kind: 'file', label: 'a' },
      { id: 'b', kind: 'file', label: 'b' },
      { id: 'c', kind: 'file', label: 'c' },
    ],
    [
      { src: 'a', rel: 'imports', dst: 'b' },
      { src: 'b', rel: 'imports', dst: 'c' },
    ]
  );
  const r = neighbours(db, 'a', { depth: 2 });
  assert.deepEqual(r, { id: "a", found: true, node: { id: "a", kind: "file", label: "a" }, rel: null, depth: 2, count: 2, truncated: false, limit: 500, kinds: { file: 2 }, neighbours: [{ id: "b", kind: "file", label: "b", rel: "imports", direction: "out", via: "a", distance: 1 }, { id: "c", kind: "file", label: "c", rel: "imports", direction: "out", via: "b", distance: 2 }] });
});
