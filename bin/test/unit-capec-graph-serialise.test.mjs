// Serialises a capec graph with sorted patterns and byCwe (bin/capec-graph.mjs serialise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialise } from '../capec-graph.mjs';

test('serialises an empty graph with zero count and empty maps', () => {
  const graph = { patterns: {}, byCwe: {} };
  const expected = JSON.stringify({ ...graph, count: 0, patterns: {}, byCwe: {} }, null, 2) + '\n';
  assert.equal(serialise(graph), expected);
});

test('serialises a graph with a single pattern and single cwe entry', () => {
  const graph = { patterns: { 1: 'p1' }, byCwe: { 1: 'c1' } };
  const expected = JSON.stringify({ ...graph, count: 1, patterns: { 1: 'p1' }, byCwe: { 1: 'c1' } }, null, 2) + '\n';
  assert.equal(serialise(graph), expected);
});

test('sorts pattern keys numerically when string keys are unsorted', () => {
  const graph = { patterns: { 10: 'a', 2: 'b', 1: 'c' }, byCwe: {} };
  const patterns = Object.fromEntries(Object.keys(graph.patterns).sort((a, b) => Number(a) - Number(b)).map((k) => [k, graph.patterns[k]]));
  const expected = JSON.stringify({ ...graph, count: 3, patterns, byCwe: {} }, null, 2) + '\n';
  assert.equal(serialise(graph), expected);
});

test('sorts byCwe keys numerically when string keys are unsorted', () => {
  const graph = { patterns: {}, byCwe: { 3: 'x', 1: 'y', 2: 'z' } };
  const byCwe = Object.fromEntries(Object.keys(graph.byCwe).sort((a, b) => Number(a) - Number(b)).map((k) => [k, graph.byCwe[k]]));
  const expected = JSON.stringify({ ...graph, count: 0, patterns: {}, byCwe }, null, 2) + '\n';
  assert.equal(serialise(graph), expected);
});

test('preserves extra top-level properties in the serialised output', () => {
  const graph = { patterns: { 1: 'p' }, byCwe: { 2: 'c' }, name: 'test' };
  const expected = JSON.stringify({ ...graph, count: 1, patterns: { 1: 'p' }, byCwe: { 2: 'c' } }, null, 2) + '\n';
  assert.equal(serialise(graph), expected);
});

test('uses two-space indentation in the JSON output', () => {
  const graph = { patterns: { 1: 'p' }, byCwe: {} };
  const result = serialise(graph);
  const lines = result.split('\n');
  assert.equal(lines[1], '  "patterns": {');
  assert.equal(lines[2], '    "1": "p"');
});

test('handles numeric keys that are already sorted', () => {
  const graph = { patterns: { 1: 'a', 2: 'b', 3: 'c' }, byCwe: { 1: 'x', 2: 'y' } };
  const expected = JSON.stringify({ ...graph, count: 3, patterns: { 1: 'a', 2: 'b', 3: 'c' }, byCwe: { 1: 'x', 2: 'y' } }, null, 2) + '\n';
  assert.equal(serialise(graph), expected);
});

test('serialises a graph with many patterns to verify count and ordering', () => {
  const patterns = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i + 1), `p${i + 1}`]).reverse());
  const graph = { patterns, byCwe: {} };
  const sortedPatterns = Object.fromEntries(Object.keys(graph.patterns).sort((a, b) => Number(a) - Number(b)).map((k) => [k, graph.patterns[k]]));
  const expected = JSON.stringify({ ...graph, count: 5, patterns: sortedPatterns, byCwe: {} }, null, 2) + '\n';
  assert.equal(serialise(graph), expected);
});
