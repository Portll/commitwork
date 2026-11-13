// The endpoint / database / scheduler node kinds and connects / listens / triggers edges, and the
// fields a merge must keep from every witness (flow/graph.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NODE_KINDS, EDGE_KINDS, makeNode, makeEdge, mergeEdges, nodeId } from '../graph.mjs';

test('the new node and edge kinds are accepted', () => {
  // arrange
  const nodes = [['endpoint', 'https://api.osv.dev'], ['endpoint', 'listen:7878'], ['database', ':memory:'], ['scheduler', 'launchd:com.x']];
  // act
  const made = nodes.map(([k, key]) => makeNode(k, key));
  const edges = ['connects', 'listens', 'triggers'].map((k) => makeEdge('a', 'b', k));
  // assert
  for (const k of ['endpoint', 'database', 'scheduler']) assert.ok(NODE_KINDS.includes(k));
  for (const k of ['connects', 'listens', 'triggers']) assert.ok(EDGE_KINDS.includes(k));
  assert.deepEqual(made.map((n) => n.id), ['node:endpoint:https://api.osv.dev', 'node:endpoint:listen:7878', 'node:database::memory:', 'node:scheduler:launchd:com.x']);
  assert.equal(Object.keys(made[0])[0], 'v');
  assert.deepEqual(edges.map((e) => [Object.keys(e)[0], e.witness, e.existence]), Array(3).fill(['v', 'static', 'unknown']));
});

test('mergeEdges unions tables and scripts and ORs append and tail across witnesses', () => {
  // arrange
  const to = nodeId('database', 'x.db');
  const edges = [
    makeEdge('m', to, 'writes', { evidence: 'm:1 exec', tables: ['b', 'a', 'a'], scripts: ['s1'] }),
    makeEdge('m', to, 'writes', { evidence: 'm:2 exec', tables: ['c'], append: true, scripts: ['s0'] }),
    makeEdge('m', to, 'writes', { evidence: 'm:3 exec', tail: true }),
  ];
  // act
  const [e] = mergeEdges(edges);
  // assert
  assert.deepEqual(e.tables, ['a', 'b', 'c']);
  assert.deepEqual(e.scripts, ['s0', 's1']);
  assert.equal(e.append, true);
  assert.equal(e.tail, true);
  assert.deepEqual(e.evidence, ['m:1 exec', 'm:2 exec', 'm:3 exec']);
});

test('mergeEdges adds union fields to an edge that first lacked them', () => {
  // arrange
  const edges = [makeEdge('m', 'n', 'reads', { evidence: 'm:1 a' }), makeEdge('m', 'n', 'reads', { evidence: 'm:2 b', tables: ['t'] })];
  // act
  const [e] = mergeEdges(edges);
  // assert
  assert.deepEqual(e.tables, ['t']);
  assert.equal(e.append, undefined);
});
