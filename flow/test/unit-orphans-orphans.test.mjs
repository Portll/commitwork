// Classifies artifact and store nodes by read/write edge presence (flow/orphans.mjs orphans).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orphans } from '../orphans.mjs';

test('returns empty buckets and zero summary for a graph with no nodes or edges', () => {
  const result = orphans({ nodes: [], edges: [] });
  assert.deepEqual(result, {
    v: 1,
    writtenNeverRead: [],
    readNeverWritten: [],
    readNeverWrittenWithFallback: [],
    directionUnknown: [],
    lowConfidence: [],
    testOnly: [],
    summary: {
      writtenNeverRead: 0,
      readNeverWritten: 0,
      readNeverWrittenWithFallback: 0,
      directionUnknown: 0,
      lowConfidenceComposed: 0,
      testFixtures: 0,
    },
  });
});

test('buckets an artifact with only touches edges as directionUnknown', () => {
  const graph = {
    nodes: [
      { id: 'node:file:src/a.txt', kind: 'artifact', path: 'src/a.txt' },
      { id: 'node:module:src/main.mjs', kind: 'module' },
    ],
    edges: [
      { from: 'node:module:src/main.mjs', to: 'node:file:src/a.txt', kind: 'touches', evidence: ['line 10'] },
    ],
  };
  const result = orphans(graph);
  assert.equal(result.summary.directionUnknown, 1);
  assert.deepEqual(result.directionUnknown, [
    { path: 'src/a.txt', referencedBy: 1, evidence: 'line 10' },
  ]);
});

test('buckets an artifact with both touches and writes edges as skipped', () => {
  const graph = {
    nodes: [
      { id: 'node:file:src/b.txt', kind: 'artifact', path: 'src/b.txt' },
      { id: 'node:module:src/main.mjs', kind: 'module' },
    ],
    edges: [
      { from: 'node:module:src/main.mjs', to: 'node:file:src/b.txt', kind: 'touches', evidence: ['line 5'] },
      { from: 'node:module:src/main.mjs', to: 'node:file:src/b.txt', kind: 'writes', evidence: ['line 6'] },
    ],
  };
  const result = orphans(graph);
  assert.equal(result.summary.directionUnknown, 0);
  assert.equal(result.summary.writtenNeverRead, 0);
  assert.equal(result.summary.readNeverWritten, 0);
  assert.equal(result.summary.lowConfidenceComposed, 0);
  assert.equal(result.summary.testFixtures, 0);
});

test('buckets a non-composed artifact written but never read as writtenNeverRead', () => {
  const graph = {
    nodes: [
      { id: 'node:file:src/c.txt', kind: 'artifact', path: 'src/c.txt' },
      { id: 'node:module:src/main.mjs', kind: 'module' },
    ],
    edges: [
      { from: 'node:module:src/main.mjs', to: 'node:file:src/c.txt', kind: 'writes', evidence: ['line 2'] },
    ],
  };
  const result = orphans(graph);
  assert.equal(result.summary.writtenNeverRead, 1);
  assert.deepEqual(result.writtenNeverRead, [
    { path: 'src/c.txt', composed: false, writers: ['src/main.mjs'], evidence: 'line 2', direction: 'written-never-read' },
  ]);
});

test('buckets a composed artifact written but never read as lowConfidence', () => {
  const graph = {
    nodes: [
      { id: 'node:file:src/d.txt', kind: 'artifact', path: 'src/d.txt', composed: true },
      { id: 'node:module:src/main.mjs', kind: 'module' },
    ],
    edges: [
      { from: 'node:module:src/main.mjs', to: 'node:file:src/d.txt', kind: 'writes', evidence: ['line 3'] },
    ],
  };
  const result = orphans(graph);
  assert.equal(result.summary.lowConfidenceComposed, 1);
  assert.deepEqual(result.lowConfidence, [
    { path: 'src/d.txt', composed: true, writers: ['src/main.mjs'], evidence: 'line 3', direction: 'written-never-read' },
  ]);
});

test('buckets an artifact written only by test modules as testOnly', () => {
  const graph = {
    nodes: [
      { id: 'node:file:fixtures/e.txt', kind: 'artifact', path: 'fixtures/e.txt' },
      { id: 'node:module:test/f.test.mjs', kind: 'module' },
    ],
    edges: [
      { from: 'node:module:test/f.test.mjs', to: 'node:file:fixtures/e.txt', kind: 'writes', evidence: ['line 4'] },
    ],
  };
  const result = orphans(graph);
  assert.equal(result.summary.testFixtures, 1);
  assert.deepEqual(result.testOnly, [
    { path: 'fixtures/e.txt', composed: false, writers: ['test/f.test.mjs'], evidence: 'line 4', direction: 'written-never-read' },
  ]);
});

test('buckets an artifact read but never written as readNeverWritten', () => {
  const graph = {
    nodes: [
      { id: 'node:file:src/f.txt', kind: 'artifact', path: 'src/f.txt' },
      { id: 'node:module:src/main.mjs', kind: 'module' },
    ],
    edges: [
      { from: 'node:module:src/main.mjs', to: 'node:file:src/f.txt', kind: 'reads', evidence: ['line 7'] },
    ],
  };
  const result = orphans(graph);
  assert.equal(result.summary.readNeverWritten, 1);
  assert.deepEqual(result.readNeverWritten, [
    { path: 'src/f.txt', composed: false, readers: ['src/main.mjs'], fallbackReaders: [], evidence: 'line 7', direction: 'read-never-written' },
  ]);
});

test('buckets an artifact read with fallback as readNeverWrittenWithFallback', () => {
  const graph = {
    nodes: [
      { id: 'node:file:src/g.txt', kind: 'artifact', path: 'src/g.txt' },
      { id: 'node:module:src/main.mjs', kind: 'module' },
    ],
    edges: [
      { from: 'node:module:src/main.mjs', to: 'node:file:src/g.txt', kind: 'reads', evidence: ['line 8'], fallback: { suspected: true, marker: 'import' } },
    ],
  };
  const result = orphans(graph);
  assert.equal(result.summary.readNeverWrittenWithFallback, 1);
  assert.deepEqual(result.readNeverWrittenWithFallback, [
    { path: 'src/g.txt', composed: false, readers: ['src/main.mjs'], fallbackReaders: [{ module: 'src/main.mjs', marker: 'import' }], evidence: 'line 8', direction: 'read-never-written-with-fallback' },
  ]);
});

test('buckets an artifact read with mixed fallback and non-fallback edges into both readNeverWritten and readNeverWrittenWithFallback', () => {
  const graph = {
    nodes: [
      { id: 'node:file:src/h.txt', kind: 'artifact', path: 'src/h.txt' },
      { id: 'node:module:src/a.mjs', kind: 'module' },
      { id: 'node:module:src/b.mjs', kind: 'module' },
    ],
    edges: [
      { from: 'node:module:src/a.mjs', to: 'node:file:src/h.txt', kind: 'reads', evidence: ['line 9'], fallback: { suspected: true, marker: 'require' } },
      { from: 'node:module:src/b.mjs', to: 'node:file:src/h.txt', kind: 'reads', evidence: ['line 10'] },
    ],
  };
  const result = orphans(graph);
  assert.equal(result.summary.readNeverWritten, 1);
  assert.equal(result.summary.readNeverWrittenWithFallback, 1);
  assert.deepEqual(result.readNeverWritten, [
    { path: 'src/h.txt', composed: false, readers: ['src/a.mjs', 'src/b.mjs'], fallbackReaders: [{ module: 'src/a.mjs', marker: 'require' }], evidence: 'line 9', direction: 'read-never-written' },
  ]);
  assert.deepEqual(result.readNeverWrittenWithFallback, [
    { path: 'src/h.txt', composed: false, readers: ['src/a.mjs', 'src/b.mjs'], fallbackReaders: [{ module: 'src/a.mjs', marker: 'require' }], evidence: 'line 9', direction: 'read-never-written-with-fallback' },
  ]);
});

test('ignores edges targeting non-artifact and non-store nodes', () => {
  const graph = {
    nodes: [
      { id: 'node:module:src/main.mjs', kind: 'module' },
      { id: 'node:module:src/util.mjs', kind: 'module' },
    ],
    edges: [
      { from: 'node:module:src/main.mjs', to: 'node:module:src/util.mjs', kind: 'reads', evidence: ['line 1'] },
    ],
  };
  const result = orphans(graph);
  assert.equal(result.summary.writtenNeverRead, 0);
  assert.equal(result.summary.readNeverWritten, 0);
  assert.equal(result.summary.directionUnknown, 0);
});
