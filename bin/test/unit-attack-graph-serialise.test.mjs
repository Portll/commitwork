// Serialises an attack graph with sorted keys and a technique count (bin/attack-graph.mjs serialise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialise } from '../attack-graph.mjs';

test('serialises an empty graph with zero count and sorted empty objects', () => {
  const graph = { techniques: {}, tactics: {} };
  const expected = JSON.stringify({ ...graph, count: 0, techniques: {}, tactics: {} }, null, 2) + '\n';
  assert.equal(serialise(graph), expected);
});

test('serialises a graph with one technique and one tactic', () => {
  const graph = { techniques: { T1: { name: 'Alpha' } }, tactics: { TA1: { name: 'Beta' } } };
  const expected = JSON.stringify({ ...graph, count: 1, techniques: { T1: { name: 'Alpha' } }, tactics: { TA1: { name: 'Beta' } } }, null, 2) + '\n';
  assert.equal(serialise(graph), expected);
});

test('sorts technique keys alphabetically in the output', () => {
  const graph = { techniques: { Z: { v: 1 }, A: { v: 2 }, M: { v: 3 } }, tactics: {} };
  const expected = JSON.stringify({ ...graph, count: 3, techniques: { A: { v: 2 }, M: { v: 3 }, Z: { v: 1 } }, tactics: {} }, null, 2) + '\n';
  assert.equal(serialise(graph), expected);
});

test('sorts tactic keys alphabetically in the output', () => {
  const graph = { techniques: {}, tactics: { Z: { v: 1 }, A: { v: 2 }, M: { v: 3 } } };
  const expected = JSON.stringify({ ...graph, count: 0, techniques: {}, tactics: { A: { v: 2 }, M: { v: 3 }, Z: { v: 1 } } }, null, 2) + '\n';
  assert.equal(serialise(graph), expected);
});

test('preserves extra top-level properties in the graph', () => {
  const graph = { techniques: { T1: {} }, tactics: { TA1: {} }, metadata: { version: 1 } };
  const expected = JSON.stringify({ ...graph, count: 1, techniques: { T1: {} }, tactics: { TA1: {} } }, null, 2) + '\n';
  assert.equal(serialise(graph), expected);
});

test('uses two-space indentation in the JSON output', () => {
  const graph = { techniques: { T1: { name: 'Test' } }, tactics: {} };
  const result = serialise(graph);
  const lines = result.split('\n');
  assert.equal(lines[1], '  "techniques": {');
  assert.equal(lines[2], '    "T1": {');
  assert.equal(lines[3], '      "name": "Test"');
});

test('ends the output with a single newline', () => {
  const graph = { techniques: {}, tactics: {} };
  const result = serialise(graph);
  assert.equal(result.endsWith('\n'), true);
  assert.equal(result.endsWith('\n\n'), false);
});

test('handles multiple techniques with complex nested structures', () => {
  const graph = {
    techniques: {
      T2: { name: 'Second', refs: ['a', 'b'] },
      T1: { name: 'First', refs: ['c'] }
    },
    tactics: { TA1: { name: 'Tactic' } }
  };
  const expected = JSON.stringify({ ...graph, count: 2, techniques: { T1: { name: 'First', refs: ['c'] }, T2: { name: 'Second', refs: ['a', 'b'] } }, tactics: { TA1: { name: 'Tactic' } } }, null, 2) + '\n';
  assert.equal(serialise(graph), expected);
});
