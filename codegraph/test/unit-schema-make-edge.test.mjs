// Builds a schema edge object with validated kind, witness, and existence (codegraph/schema.mjs makeEdge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEdge } from '../schema.mjs';

test('returns an edge with defaults for a valid kind', () => {
  const r = makeEdge('a', 'b', 'imports');
  assert.deepEqual(r, { v: 1, from: "a", to: "b", kind: "imports", witness: "lexical", existence: "unknown", evidence: null });
});

test('throws for an unknown edge kind', () => {
  assert.throws(() => makeEdge('a', 'b', 'bogus'), { name: 'Error', message: 'unknown edge kind bogus' });
});

test('returns an edge with custom witness and existence', () => {
  const r = makeEdge('a', 'b', 'calls', { witness: 'v8', existence: 'confirmed' });
  assert.deepEqual(r, { v: 1, from: "a", to: "b", kind: "calls", witness: "v8", existence: "confirmed", evidence: null });
});

test('throws for an unknown witness', () => {
  assert.throws(() => makeEdge('a', 'b', 'imports', { witness: 'bad' }), { name: 'Error', message: 'unknown witness bad' });
});

test('throws for an unknown existence', () => {
  assert.throws(() => makeEdge('a', 'b', 'imports', { existence: 'bad' }), { name: 'Error', message: 'unknown existence bad' });
});

test('spreads extra properties into the edge', () => {
  const r = makeEdge('a', 'b', 'defines', { extra: 1 });
  assert.deepEqual(r, { v: 1, from: "a", to: "b", kind: "defines", witness: "lexical", existence: "unknown", evidence: null, extra: 1 });
});

test('returns an edge with evidence set', () => {
  const r = makeEdge('a', 'b', 'reexports', { evidence: 'ev' });
  assert.deepEqual(r, { v: 1, from: "a", to: "b", kind: "reexports", witness: "lexical", existence: "unknown", evidence: "ev" });
});

test('returns an edge for binds kind with both witness', () => {
  const r = makeEdge('a', 'b', 'binds', { witness: 'both', existence: 'contradicted' });
  assert.deepEqual(r, { v: 1, from: "a", to: "b", kind: "binds", witness: "both", existence: "contradicted", evidence: null });
});
