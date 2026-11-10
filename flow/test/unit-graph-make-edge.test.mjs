// Builds a versioned edge object with validated kind, witness, and existence (flow/graph.mjs makeEdge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEdge } from '../graph.mjs';

test('returns an edge object with defaults for a valid kind', () => {
  const r = makeEdge('a', 'b', 'reads');
  assert.deepEqual(r, { v: 1, from: "a", to: "b", kind: "reads", witness: "static", existence: "unknown", evidence: null });
});

test('returns an edge object with custom witness and existence', () => {
  const r = makeEdge('a', 'b', 'writes', { witness: 'runtime', existence: 'confirmed' });
  assert.deepEqual(r, { v: 1, from: "a", to: "b", kind: "writes", witness: "runtime", existence: "confirmed", evidence: null });
});

test('returns an edge object with evidence and extra properties', () => {
  const r = makeEdge('a', 'b', 'spawns', { witness: 'both', existence: 'contradicted', evidence: 'x', extra: 1 });
  assert.deepEqual(r, { v: 1, from: "a", to: "b", kind: "spawns", witness: "both", existence: "contradicted", evidence: "x", extra: 1 });
});

test('returns an edge object for the touches kind', () => {
  const r = makeEdge('a', 'b', 'touches');
  assert.deepEqual(r, { v: 1, from: "a", to: "b", kind: "touches", witness: "static", existence: "unknown", evidence: null });
});

test('throws for an unknown edge kind', () => {
  assert.throws(() => makeEdge('a', 'b', 'invalid'), { name: 'Error', message: 'unknown edge kind invalid' });
});

test('throws for an unknown witness', () => {
  assert.throws(() => makeEdge('a', 'b', 'reads', { witness: 'bad' }), { name: 'Error', message: 'unknown witness bad' });
});

test('throws for an unknown existence', () => {
  assert.throws(() => makeEdge('a', 'b', 'reads', { existence: 'bad' }), { name: 'Error', message: 'unknown existence bad' });
});

test('returns an edge object with null evidence', () => {
  const r = makeEdge('a', 'b', 'reads', { evidence: null });
  assert.deepEqual(r, { v: 1, from: "a", to: "b", kind: "reads", witness: "static", existence: "unknown", evidence: null });
});
