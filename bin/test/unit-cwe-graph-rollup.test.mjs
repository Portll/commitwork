// Returns the nearest ancestor (or self) at the given abstraction level (bin/cwe-graph.mjs rollup).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollup } from '../cwe-graph.mjs';

test('returns self when self matches the requested abstraction level', () => {
  const graph = { cwes: { '119': { abstraction: 'Pillar', ChildOf: ['284'] } } };
  const r = rollup(graph, 'CWE-119', 'Pillar');
  assert.equal(r, "119");
});

test('returns empty string when self is missing from the graph', () => {
  const graph = { cwes: { '119': { abstraction: 'Pillar' } } };
  const r = rollup(graph, 'CWE-999', 'Pillar');
  assert.equal(r, "");
});

test('returns empty string when self exists but has a different abstraction level', () => {
  const graph = { cwes: { '119': { abstraction: 'Class', ChildOf: ['284'] }, '284': { abstraction: 'Pillar' } } };
  const r = rollup(graph, 'CWE-119', 'Pillar');
  assert.equal(r, "284");
});

test('returns the first ancestor that matches the requested abstraction level', () => {
  const graph = { cwes: { '119': { abstraction: 'Class', ChildOf: ['284'] }, '284': { abstraction: 'Pillar' } } };
  const r = rollup(graph, 'CWE-119', 'Pillar');
  assert.equal(r, "284");
});

test('returns empty string when no ancestor matches the requested abstraction level', () => {
  const graph = { cwes: { '119': { abstraction: 'Class', ChildOf: ['284'] }, '284': { abstraction: 'Class' } } };
  const r = rollup(graph, 'CWE-119', 'Pillar');
  assert.equal(r, "");
});

test('returns the second ancestor when the first does not match the level', () => {
  const graph = {
    cwes: {
      '119': { abstraction: 'Class', ChildOf: ['284'] },
      '284': { abstraction: 'Class', ChildOf: ['666'] },
      '666': { abstraction: 'Pillar' }
    }
  };
  const r = rollup(graph, 'CWE-119', 'Pillar');
  assert.equal(r, "666");
});

test('returns self when self matches a custom abstraction level', () => {
  const graph = { cwes: { '119': { abstraction: 'Base', ChildOf: ['284'] } } };
  const r = rollup(graph, 'CWE-119', 'Base');
  assert.equal(r, "119");
});

test('returns empty string when self has no ChildOf and does not match the level', () => {
  const graph = { cwes: { '119': { abstraction: 'Class' } } };
  const r = rollup(graph, 'CWE-119', 'Pillar');
  assert.equal(r, "");
});
