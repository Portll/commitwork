// writes the CWE graph with sorted cwes and categories and a cwe count, returning the path (bin/cwe-graph.mjs write).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { write } from '../cwe-graph.mjs';

const capture = (graph, ...rest) => {
  let seen = null;
  const probe = {
    ...graph,
    toJSON(key) {
      seen = { key, out: this };
      throw new Error('captured before writing');
    },
  };
  assert.throws(() => write(probe, ...rest), { name: 'Error', message: 'captured before writing' });
  return seen;
};

test('an empty graph is serialised from the top level with count 0 appended after its own fields', () => {
  const { key, out } = capture({ cwes: {}, categories: {} }, 'unused.json');
  assert.equal(key, '');
  assert.deepEqual(Object.keys(out), ['cwes', 'categories', 'toJSON', 'count']);
  assert.equal(out.count, 0);
  assert.deepEqual(out.cwes, {});
  assert.deepEqual(out.categories, {});
});

test('cwe keys are put in numeric order and count is the number of cwes', () => {
  const cwes = { '0.5': { name: 'x' }, '-1': { name: 'y' }, '-3': { name: 'z' } };
  const { out } = capture({ cwes, categories: {} }, 'unused.json');
  assert.deepEqual(Object.keys(out.cwes), ['-3', '-1', '0.5']);
  assert.deepEqual(out.cwes, { '-3': { name: 'z' }, '-1': { name: 'y' }, '0.5': { name: 'x' } });
  assert.equal(out.count, 3);
});

test('integer cwe keys stay first while the other keys follow in numeric order', () => {
  const { out } = capture({ cwes: { '1.5': 'c', '-1': 'b', 2: 'a' }, categories: {} }, 'unused.json');
  assert.deepEqual(Object.keys(out.cwes), ['2', '-1', '1.5']);
  assert.deepEqual(out.cwes, { 2: 'a', '-1': 'b', '1.5': 'c' });
  assert.equal(out.count, 3);
});

test('category keys are put in numeric order and do not add to the count', () => {
  const { out } = capture({ cwes: { 7: 'a' }, categories: { '1e1': 'p', '-2': 'q' } }, 'unused.json');
  assert.deepEqual(Object.keys(out.categories), ['-2', '1e1']);
  assert.deepEqual(out.categories, { '-2': 'q', '1e1': 'p' });
  assert.deepEqual(out.cwes, { 7: 'a' });
  assert.equal(out.count, 1);
});

test('other fields keep their position and a stale count is replaced in place', () => {
  const graph = { count: 99, title: 't', cwes: { 1: 'a', 2: 'b' }, categories: {} };
  const { out } = capture(graph, 'unused.json');
  assert.deepEqual(Object.keys(out), ['count', 'title', 'cwes', 'categories', 'toJSON']);
  assert.equal(out.count, 2);
  assert.equal(out.title, 't');
});

test('without a path argument the graph is serialised the same way', () => {
  const { key, out } = capture({ cwes: { 3: 'c' }, categories: { 4: 'd' } });
  assert.equal(key, '');
  assert.deepEqual(out.cwes, { 3: 'c' });
  assert.deepEqual(out.categories, { 4: 'd' });
  assert.equal(out.count, 1);
});

test('the caller graph and its cwes object are left unchanged', () => {
  const graph = { cwes: { '0.5': 'x', '-1': 'y' }, categories: { '2.5': 'p', '-4': 'q' } };
  capture(graph, 'unused.json');
  assert.deepEqual(Object.keys(graph), ['cwes', 'categories']);
  assert.deepEqual(Object.keys(graph.cwes), ['0.5', '-1']);
  assert.deepEqual(Object.keys(graph.categories), ['2.5', '-4']);
});

test('a null graph throws a TypeError before anything is written', () => {
  assert.throws(() => write(null, 'unused.json'), {
    name: 'TypeError',
    message: "Cannot read properties of null (reading 'cwes')",
  });
});

test('calling with no arguments throws a TypeError for the missing graph', () => {
  assert.throws(() => write(), {
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading 'cwes')",
  });
});

test('a graph missing cwes or categories throws a TypeError', () => {
  assert.throws(() => write({ categories: {} }, 'unused.json'), {
    name: 'TypeError',
    message: 'Cannot convert undefined or null to object',
  });
  assert.throws(() => write({ cwes: { 1: 'a' } }, 'unused.json'), {
    name: 'TypeError',
    message: 'Cannot convert undefined or null to object',
  });
});
