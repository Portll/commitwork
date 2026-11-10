// Merges duplicate edges by key and unions their evidence (flow/graph.mjs mergeEdges).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEdges } from '../graph.mjs';

test('returns an empty array for an empty input', () => {
  assert.deepEqual(mergeEdges([]), []);
});

test('preserves a single edge with no evidence property', () => {
  assert.deepEqual(mergeEdges([{ from: 'a', to: 'b', kind: 'k' }]), [{ from: "a", to: "b", kind: "k", evidence: [] }]);
});

test('preserves a single edge with an empty evidence array', () => {
  assert.deepEqual(mergeEdges([{ from: 'a', to: 'b', kind: 'k', evidence: [] }]), [{ from: "a", to: "b", kind: "k", evidence: [] }]);
});

test('preserves a single edge with a non-empty evidence array', () => {
  assert.deepEqual(mergeEdges([{ from: 'a', to: 'b', kind: 'k', evidence: ['e1'] }]), [{ from: "a", to: "b", kind: "k", evidence: ["e1"] }]);
});

test('keeps two distinct edges in sorted order', () => {
  const edges = [
    { from: 'z', to: 'y', kind: 'k' },
    { from: 'a', to: 'b', kind: 'k' }
  ];
  assert.deepEqual(mergeEdges(edges), [{ from: "a", to: "b", kind: "k", evidence: [] }, { from: "z", to: "y", kind: "k", evidence: [] }]);
});

test('merges duplicate edges and unions their evidence', () => {
  const edges = [
    { from: 'a', to: 'b', kind: 'k', evidence: ['e1'] },
    { from: 'a', to: 'b', kind: 'k', evidence: ['e2'] }
  ];
  assert.deepEqual(mergeEdges(edges), [{ from: "a", to: "b", kind: "k", evidence: ["e1", "e2"] }]);
});

test('merges duplicates where the second edge has no evidence property', () => {
  const edges = [
    { from: 'a', to: 'b', kind: 'k', evidence: ['e1'] },
    { from: 'a', to: 'b', kind: 'k' }
  ];
  assert.deepEqual(mergeEdges(edges), [{ from: "a", to: "b", kind: "k", evidence: ["e1"] }]);
});

test('merges duplicates where the second edge has an empty evidence array', () => {
  const edges = [
    { from: 'a', to: 'b', kind: 'k', evidence: ['e1'] },
    { from: 'a', to: 'b', kind: 'k', evidence: [] }
  ];
  assert.deepEqual(mergeEdges(edges), [{ from: "a", to: "b", kind: "k", evidence: ["e1"] }]);
});

test('does not duplicate evidence values already present in the merged edge', () => {
  const edges = [
    { from: 'a', to: 'b', kind: 'k', evidence: ['e1', 'e2'] },
    { from: 'a', to: 'b', kind: 'k', evidence: ['e2', 'e3'] }
  ];
  assert.deepEqual(mergeEdges(edges), [{ from: "a", to: "b", kind: "k", evidence: ["e1", "e2", "e3"] }]);
});

test('does not mutate the evidence arrays of the input edges', () => {
  const ev1 = ['e1'];
  const ev2 = ['e2'];
  const edges = [
    { from: 'a', to: 'b', kind: 'k', evidence: ev1 },
    { from: 'a', to: 'b', kind: 'k', evidence: ev2 }
  ];
  mergeEdges(edges);
  assert.deepEqual(ev1, ["e1"]);
});
