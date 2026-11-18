// The graph primitives of lib/dfd.mjs on hand-built adjacency lists. Analysis through `analyse` is
// covered in dfd.test.mjs; these tests pin the primitives' own contracts: how Tarjan numbers a
// component, which arcs count as back arcs, and what longest-path layering does at its edges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stronglyConnected, backArcs, longestPathRanks } from '../dfd.mjs';

// an adjacency entry is [target index, arc key]

// ── stronglyConnected ───────────────────────────────────────────────────────────────────────────

test('stronglyConnected: an empty graph has no components', () => {
  const r = stronglyConnected([]);

  assert.deepEqual(r, { comp: [], count: 0 });
});

test('stronglyConnected: a node without an arc is its own component', () => {
  const r = stronglyConnected([[]]);

  assert.deepEqual(r, { comp: [0], count: 1 });
});

test('stronglyConnected: a self loop is one component of one node', () => {
  const r = stronglyConnected([[[0, 0]]]);

  assert.deepEqual(r, { comp: [0], count: 1 });
});

test('stronglyConnected: a 3-cycle is one component of three nodes', () => {
  const out = [[[1, 0]], [[2, 1]], [[0, 2]]];

  const r = stronglyConnected(out);

  assert.deepEqual(r, { comp: [0, 0, 0], count: 1 });
});

test('stronglyConnected: two cycles joined by a one-way edge are numbered by their first member', () => {
  // 0 <-> 1, then 1 -> 2 -> 3 -> 4 -> 2: the edge between the cycles is one-way
  const out = [
    [[1, 0]],
    [[0, 1], [2, 2]],
    [[3, 3]],
    [[4, 4]],
    [[2, 5]],
  ];

  const r = stronglyConnected(out);

  assert.deepEqual(r, { comp: [0, 0, 1, 1, 1], count: 2 });
});

test('stronglyConnected: a chain with no cycle gives every node its own component', () => {
  const out = [[[1, 0]], [[2, 1]], [[3, 2]], []];

  const r = stronglyConnected(out);

  assert.deepEqual(r, { comp: [0, 1, 2, 3], count: 4 });
});

test('stronglyConnected: the same input twice gives the same result', () => {
  const out = [[[1, 0]], [[2, 1]], [[0, 2]], [[4, 3]], [[3, 4]]];

  assert.deepEqual(stronglyConnected(out), stronglyConnected(out));
  assert.deepEqual(stronglyConnected(out), { comp: [0, 0, 0, 1, 1], count: 2 });
});

// ── backArcs ────────────────────────────────────────────────────────────────────────────────────

test('backArcs: a DAG yields no back arc', () => {
  const out = [[[1, 0]], [[2, 1]], []];

  const { comp, count } = stronglyConnected(out);
  const back = backArcs(out, comp, count);

  assert.deepEqual([...back], []);
});

test('backArcs: a 3-cycle yields exactly one back arc, the arc that closes the walk', () => {
  // nothing enters the component, so the walk starts at 0 and follows 0 -> 1 -> 2, making 2 -> 0 the back arc
  const out = [[[1, 0]], [[2, 1]], [[0, 2]]];

  const { comp, count } = stronglyConnected(out);
  const back = backArcs(out, comp, count);

  assert.deepEqual([...back], [2]);
  assert.equal(back.size, 1);
});

test('backArcs: a lone self loop is not a back arc', () => {
  // the loop is a one-node component, and the walk only runs for a component of two or more
  const out = [[[0, 0]]];

  const { comp, count } = stronglyConnected(out);
  const back = backArcs(out, comp, count);

  assert.deepEqual([...back], []);
});

test('backArcs: an arc between two components is never a back arc', () => {
  // 0 <-> 3 and 1 <-> 2 are separate components; 0 -> 2 and 0 -> 1 leave the first
  const out = [
    [[3, 0], [2, 4], [1, 5]],
    [[2, 2]],
    [[1, 3]],
    [[0, 1]],
  ];

  const { comp, count } = stronglyConnected(out);
  assert.deepEqual(comp, [0, 1, 1, 0]);
  const back = backArcs(out, comp, count);

  assert.deepEqual([...back], [1, 3]);
});

test('backArcs: parallel arcs are reported by their own arc key', () => {
  // 0 -> 1 twice (keys 0, 1) and 1 -> 0 once (key 2): only 2 returns into the walk
  const out = [[[1, 0], [1, 1]], [[0, 2]]];

  const { comp, count } = stronglyConnected(out);
  const back = backArcs(out, comp, count);

  assert.deepEqual([...back], [2]);
});

// ── longestPathRanks ───────────────────────────────────────────────────────────────────────────

test('longestPathRanks: a chain ranks 0 to n-1', () => {
  const r = longestPathRanks(4, [[0, 1], [1, 2], [2, 3]]);

  assert.deepEqual(r, { rank: [0, 1, 2, 3], order: [0, 1, 2, 3] });
});

test('longestPathRanks: a join node takes the longest path into it', () => {
  // a diamond with unequal sides: 0 -> 3 -> 4 is two hops, 0 -> 1 -> 2 -> 4 is three
  const r = longestPathRanks(5, [[0, 1], [0, 3], [1, 2], [2, 4], [3, 4]]);

  assert.deepEqual(r, { rank: [0, 1, 2, 1, 3], order: [0, 1, 3, 2, 4] });
});

test('longestPathRanks: isolated nodes rank 0', () => {
  const r = longestPathRanks(3, []);

  assert.deepEqual(r, { rank: [0, 0, 0], order: [0, 1, 2] });
});

test('longestPathRanks: no nodes and no arcs is an empty result', () => {
  const r = longestPathRanks(0, []);

  assert.deepEqual(r, { rank: [], order: [] });
});

test('longestPathRanks: an arc whose source is out of range is a TypeError', () => {
  const run = () => longestPathRanks(2, [[5, 0]]);

  assert.throws(run, { name: 'TypeError', message: /undefined/ });
});

test('longestPathRanks: an arc whose target is out of range is ignored, not an error', () => {
  const r = longestPathRanks(2, [[0, 1], [0, 5]]);

  assert.deepEqual(r, { rank: [0, 1], order: [0, 1] });
});

test('longestPathRanks: a 3-cycle is refused and the call returns', () => {
  const run = () => longestPathRanks(3, [[0, 1], [1, 2], [2, 0]]);

  assert.throws(run, /longestPathRanks was given a cyclic arc list/);
});

test('longestPathRanks: a self loop is refused', () => {
  const run = () => longestPathRanks(1, [[0, 0]]);

  assert.throws(run, /cyclic arc list/);
});
