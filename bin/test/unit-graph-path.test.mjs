// Finds a shortest path between two nodes in a graph (bin/graph.mjs path).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { path } from '../graph.mjs';

const mkDb = (nodes, edges) => {
  const db = {
    _nodes: new Map(nodes.map((n) => [n.id, n])),
    _edges: edges,
    prepare() {
      return {
        get: (id) => db._nodes.get(id) || null,
        all: (id, rel) =>
          db._edges
            .filter((e) => (rel ? e.rel === rel : true) && (e.src === id || e.dst === id))
            .map((e) => ({ src: e.src, rel: e.rel, dst: e.dst })),
      };
    },
  };
  return db;
};

const nodes = [
  { id: 'a', kind: 'file', label: 'A' },
  { id: 'b', kind: 'file', label: 'B' },
  { id: 'c', kind: 'file', label: 'C' },
  { id: 'd', kind: 'file', label: 'D' },
  { id: 'e', kind: 'file', label: 'E' },
  { id: 'f', kind: 'file', label: 'F' },
  { id: 'g', kind: 'file', label: 'G' },
  { id: 'h', kind: 'file', label: 'H' },
  { id: 'i', kind: 'file', label: 'I' },
  { id: 'j', kind: 'file', label: 'J' },
  { id: 'k', kind: 'file', label: 'K' },
  { id: 'l', kind: 'file', label: 'L' },
  { id: 'm', kind: 'file', label: 'M' },
  { id: 'n', kind: 'file', label: 'N' },
  { id: 'o', kind: 'file', label: 'O' },
  { id: 'p', kind: 'file', label: 'P' },
  { id: 'q', kind: 'file', label: 'Q' },
  { id: 'r', kind: 'file', label: 'R' },
  { id: 's', kind: 'file', label: 'S' },
  { id: 't', kind: 'file', label: 'T' },
  { id: 'u', kind: 'file', label: 'U' },
  { id: 'v', kind: 'file', label: 'V' },
  { id: 'w', kind: 'file', label: 'W' },
  { id: 'x', kind: 'file', label: 'X' },
  { id: 'y', kind: 'file', label: 'Y' },
  { id: 'z', kind: 'file', label: 'Z' },
];

const edges = [
  { src: 'a', rel: 'imports', dst: 'b' },
  { src: 'b', rel: 'imports', dst: 'c' },
  { src: 'c', rel: 'imports', dst: 'd' },
  { src: 'd', rel: 'imports', dst: 'e' },
  { src: 'e', rel: 'imports', dst: 'f' },
  { src: 'f', rel: 'imports', dst: 'g' },
  { src: 'g', rel: 'imports', dst: 'h' },
  { src: 'h', rel: 'imports', dst: 'i' },
  { src: 'i', rel: 'imports', dst: 'j' },
  { src: 'j', rel: 'imports', dst: 'k' },
  { src: 'k', rel: 'imports', dst: 'l' },
  { src: 'l', rel: 'imports', dst: 'm' },
  { src: 'm', rel: 'imports', dst: 'n' },
  { src: 'n', rel: 'imports', dst: 'o' },
  { src: 'o', rel: 'imports', dst: 'p' },
  { src: 'p', rel: 'imports', dst: 'q' },
  { src: 'q', rel: 'imports', dst: 'r' },
  { src: 'r', rel: 'imports', dst: 's' },
  { src: 's', rel: 'imports', dst: 't' },
  { src: 't', rel: 'imports', dst: 'u' },
  { src: 'u', rel: 'imports', dst: 'v' },
  { src: 'v', rel: 'imports', dst: 'w' },
  { src: 'w', rel: 'imports', dst: 'x' },
  { src: 'x', rel: 'imports', dst: 'y' },
  { src: 'y', rel: 'imports', dst: 'z' },
];

test('returns found false when source node is missing', () => {
  const db = mkDb(nodes, edges);
  const r = path(db, 'missing', 'b');
  assert.deepEqual(r, { from: "missing", to: "b", found: false, reason: "no node missing in the graph" });
});

test('returns found false when target node is missing', () => {
  const db = mkDb(nodes, edges);
  const r = path(db, 'a', 'missing');
  assert.deepEqual(r, { from: "a", to: "missing", found: false, reason: "no node missing in the graph" });
});

test('returns found false when no path exists within depth', () => {
  const db = mkDb(nodes, edges);
  const r = path(db, 'a', 'z', { depth: 1 });
  assert.deepEqual(r, { from: "a", to: "z", found: false, depth: 1, reason: "no path within 1 hops" });
});

test('returns found true with correct path for direct edge', () => {
  const db = mkDb(nodes, edges);
  const r = path(db, 'a', 'b');
  assert.deepEqual(r, { from: "a", to: "b", found: true, depth: 8, length: 1, nodes: [{ id: "a", kind: "file", label: "A" }, { id: "b", kind: "file", label: "B" }], edges: [{ src: "a", rel: "imports", dst: "b" }] });
});

test('returns found true with correct path for two-hop path', () => {
  const db = mkDb(nodes, edges);
  const r = path(db, 'a', 'c');
  assert.deepEqual(r, { from: "a", to: "c", found: true, depth: 8, length: 2, nodes: [{ id: "a", kind: "file", label: "A" }, { id: "b", kind: "file", label: "B" }, { id: "c", kind: "file", label: "C" }], edges: [{ src: "a", rel: "imports", dst: "b" }, { src: "b", rel: "imports", dst: "c" }] });
});

test('returns found true with correct path for three-hop path', () => {
  const db = mkDb(nodes, edges);
  const r = path(db, 'a', 'd');
  assert.deepEqual(r, { from: "a", to: "d", found: true, depth: 8, length: 3, nodes: [{ id: "a", kind: "file", label: "A" }, { id: "b", kind: "file", label: "B" }, { id: "c", kind: "file", label: "C" }, { id: "d", kind: "file", label: "D" }], edges: [{ src: "a", rel: "imports", dst: "b" }, { src: "b", rel: "imports", dst: "c" }, { src: "c", rel: "imports", dst: "d" }] });
});

test('returns found true with correct path for four-hop path', () => {
  const db = mkDb(nodes, edges);
  const r = path(db, 'a', 'e');
  assert.deepEqual(r, { from: "a", to: "e", found: true, depth: 8, length: 4, nodes: [{ id: "a", kind: "file", label: "A" }, { id: "b", kind: "file", label: "B" }, { id: "c", kind: "file", label: "C" }, { id: "d", kind: "file", label: "D" }, { id: "e", kind: "file", label: "E" }], edges: [{ src: "a", rel: "imports", dst: "b" }, { src: "b", rel: "imports", dst: "c" }, { src: "c", rel: "imports", dst: "d" }, { src: "d", rel: "imports", dst: "e" }] });
});

test('returns found true with correct path for five-hop path', () => {
  const db = mkDb(nodes, edges);
  const r = path(db, 'a', 'f');
  assert.deepEqual(r, { from: "a", to: "f", found: true, depth: 8, length: 5, nodes: [{ id: "a", kind: "file", label: "A" }, { id: "b", kind: "file", label: "B" }, { id: "c", kind: "file", label: "C" }, { id: "d", kind: "file", label: "D" }, { id: "e", kind: "file", label: "E" }, { id: "f", kind: "file", label: "F" }], edges: [{ src: "a", rel: "imports", dst: "b" }, { src: "b", rel: "imports", dst: "c" }, { src: "c", rel: "imports", dst: "d" }, { src: "d", rel: "imports", dst: "e" }, { src: "e", rel: "imports", dst: "f" }] });
});

test('returns found true with correct path for six-hop path', () => {
  const db = mkDb(nodes, edges);
  const r = path(db, 'a', 'g');
  assert.deepEqual(r, { from: "a", to: "g", found: true, depth: 8, length: 6, nodes: [{ id: "a", kind: "file", label: "A" }, { id: "b", kind: "file", label: "B" }, { id: "c", kind: "file", label: "C" }, { id: "d", kind: "file", label: "D" }, { id: "e", kind: "file", label: "E" }, { id: "f", kind: "file", label: "F" }, { id: "g", kind: "file", label: "G" }], edges: [{ src: "a", rel: "imports", dst: "b" }, { src: "b", rel: "imports", dst: "c" }, { src: "c", rel: "imports", dst: "d" }, { src: "d", rel: "imports", dst: "e" }, { src: "e", rel: "imports", dst: "f" }, { src: "f", rel: "imports", dst: "g" }] });
});

test('returns found true with correct path for seven-hop path', () => {
  const db = mkDb(nodes, edges);
  const r = path(db, 'a', 'h');
  assert.deepEqual(r, { from: "a", to: "h", found: true, depth: 8, length: 7, nodes: [{ id: "a", kind: "file", label: "A" }, { id: "b", kind: "file", label: "B" }, { id: "c", kind: "file", label: "C" }, { id: "d", kind: "file", label: "D" }, { id: "e", kind: "file", label: "E" }, { id: "f", kind: "file", label: "F" }, { id: "g", kind: "file", label: "G" }, { id: "h", kind: "file", label: "H" }], edges: [{ src: "a", rel: "imports", dst: "b" }, { src: "b", rel: "imports", dst: "c" }, { src: "c", rel: "imports", dst: "d" }, { src: "d", rel: "imports", dst: "e" }, { src: "e", rel: "imports", dst: "f" }, { src: "f", rel: "imports", dst: "g" }, { src: "g", rel: "imports", dst: "h" }] });
});
