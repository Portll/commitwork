// Builds a versioned node object with a validated kind (codegraph/schema.mjs makeNode).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNode } from '../schema.mjs';

test('returns a module node with schema version and id', () => {
  const r = makeNode('module', 'm1');
  assert.deepEqual(r, { v: 1, id: "m1", kind: "module" });
});

test('returns a symbol node with extra fields spread in', () => {
  const r = makeNode('symbol', 's1', { name: 'foo' });
  assert.deepEqual(r, { v: 1, id: "s1", kind: "symbol", name: "foo" });
});

test('returns an external node with extra fields spread in', () => {
  const r = makeNode('external', 'e1', { url: 'x' });
  assert.deepEqual(r, { v: 1, id: "e1", kind: "external", url: "x" });
});

test('throws for an unknown node kind', () => {
  assert.throws(() => makeNode('bogus', 'x'), { name: 'Error', message: 'unknown node kind bogus' });
});

test('throws for an empty string kind', () => {
  assert.throws(() => makeNode('', 'x'), { name: 'Error', message: 'unknown node kind ' });
});

test('throws for a numeric kind', () => {
  assert.throws(() => makeNode(1, 'x'), { name: 'Error', message: 'unknown node kind 1' });
});

test('returns a module node with no extra fields', () => {
  const r = makeNode('module', 'm2', {});
  assert.deepEqual(r, { v: 1, id: "m2", kind: "module" });
});

test('returns a symbol node with multiple extra fields', () => {
  const r = makeNode('symbol', 's2', { a: 1, b: 2 });
  assert.deepEqual(r, { v: 1, id: "s2", kind: "symbol", a: 1, b: 2 });
});
