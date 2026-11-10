// Subsumptions lacking a mechanism-of edge (bin/taxonomy-lattice.mjs unbackedSubsumptions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unbackedSubsumptions } from '../taxonomy-lattice.mjs';

test('returns empty array when no subsumptions are provided', () => {
  const r = unbackedSubsumptions([], []);
  assert.deepEqual(r, []);
});

test('returns empty array when all subsumptions are backed by mechanism-of edges', () => {
  const subs = [['a', 'b']];
  const edges = [{ from: 'a', to: 'b', relation: 'mechanism-of' }];
  const r = unbackedSubsumptions(subs, edges);
  assert.deepEqual(r, []);
});

test('returns subsumption when no edges are provided', () => {
  const subs = [['a', 'b']];
  const edges = [];
  const r = unbackedSubsumptions(subs, edges);
  assert.deepEqual(r, [["a", "b"]]);
});

test('returns subsumption when edge has a different relation', () => {
  const subs = [['a', 'b']];
  const edges = [{ from: 'a', to: 'b', relation: 'part-of' }];
  const r = unbackedSubsumptions(subs, edges);
  assert.deepEqual(r, [["a", "b"]]);
});

test('returns subsumption when edge direction is reversed', () => {
  const subs = [['a', 'b']];
  const edges = [{ from: 'b', to: 'a', relation: 'mechanism-of' }];
  const r = unbackedSubsumptions(subs, edges);
  assert.deepEqual(r, [["a", "b"]]);
});

test('filters out only the backed subsumption among multiple', () => {
  const subs = [['a', 'b'], ['c', 'd']];
  const edges = [{ from: 'a', to: 'b', relation: 'mechanism-of' }];
  const r = unbackedSubsumptions(subs, edges);
  assert.deepEqual(r, [["c", "d"]]);
});

test('keeps subsumptions that do not match any edge', () => {
  const subs = [['x', 'y'], ['z', 'w']];
  const edges = [{ from: 'a', to: 'b', relation: 'mechanism-of' }];
  const r = unbackedSubsumptions(subs, edges);
  assert.deepEqual(r, [["x", "y"], ["z", "w"]]);
});

test('handles multiple mechanism-of edges backing different subsumptions', () => {
  const subs = [['a', 'b'], ['c', 'd'], ['e', 'f']];
  const edges = [
    { from: 'a', to: 'b', relation: 'mechanism-of' },
    { from: 'c', to: 'd', relation: 'mechanism-of' }
  ];
  const r = unbackedSubsumptions(subs, edges);
  assert.deepEqual(r, [["e", "f"]]);
});
