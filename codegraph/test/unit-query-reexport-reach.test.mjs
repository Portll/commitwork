// Computes the set of bound and member names reachable through re-exports (codegraph/query.mjs reexportReach).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reexportReach } from '../query.mjs';

test('empty graph yields empty bound and member', () => {
  const r = reexportReach({ nodes: [], edges: [] });
  assert.deepEqual(r, { bound: new Set([]), member: new Map([]) });
});

test('a binds edge records the symbol as bound', () => {
  const r = reexportReach({
    nodes: [{ id: 'sym:a#x', kind: 'symbol', name: 'x', path: 'a' }],
    edges: [{ kind: 'binds', from: 'mod:a', to: 'sym:a#x' }]
  });
  assert.deepEqual(r, { bound: new Set(["sym:a#x"]), member: new Map([]) });
});

test('namespaceImported surfaces exported names as members', () => {
  const r = reexportReach({
    nodes: [
      { id: 'mod:a', kind: 'module', path: 'a' },
      { id: 'sym:a#x', kind: 'symbol', name: 'x', path: 'a', exported: true }
    ],
    edges: [],
    namespaceImported: ['a']
  });
  assert.deepEqual(r, { bound: new Set([]), member: new Map([["sym:a#x", "a is bound as a namespace or default object"]]) });
});

test('dynamicallyImported surfaces exported names as members', () => {
  const r = reexportReach({
    nodes: [
      { id: 'mod:a', kind: 'module', path: 'a' },
      { id: 'sym:a#y', kind: 'symbol', name: 'y', path: 'a', exported: true }
    ],
    edges: [],
    dynamicallyImported: ['a']
  });
  assert.deepEqual(r, { bound: new Set([]), member: new Map([["sym:a#y", "a is reached by a dynamic import, which names no bindings"]]) });
});

test('star reexport propagates members with noDefault true', () => {
  const r = reexportReach({
    nodes: [
      { id: 'mod:a', kind: 'module', path: 'a' },
      { id: 'mod:b', kind: 'module', path: 'b' },
      { id: 'sym:a#x', kind: 'symbol', name: 'x', path: 'a', exported: true },
      { id: 'sym:a#default', kind: 'symbol', name: 'default', path: 'a', exported: true }
    ],
    edges: [
      { kind: 'reexports', from: 'mod:b', to: 'mod:a', star: true }
    ],
    namespaceImported: ['b']
  });
  assert.deepEqual(r, { bound: new Set([]), member: new Map([["sym:a#x", "b is bound as a namespace or default object"]]) });
});

test('non-star reexport propagates the named symbol', () => {
  const r = reexportReach({
    nodes: [
      { id: 'mod:a', kind: 'module', path: 'a' },
      { id: 'mod:b', kind: 'module', path: 'b' },
      { id: 'sym:a#x', kind: 'symbol', name: 'x', path: 'a', exported: true }
    ],
    edges: [
      { kind: 'reexports', from: 'mod:b', to: 'sym:a#x', star: false }
    ],
    namespaceImported: ['b']
  });
  assert.deepEqual(r, { bound: new Set([]), member: new Map([]) });
});

test('default export that is an object literal surfaces its members', () => {
  const r = reexportReach({
    nodes: [
      { id: 'mod:a', kind: 'module', path: 'a', defaultObjectLiteral: true },
      { id: 'sym:a#default', kind: 'symbol', name: 'default', path: 'a', exported: true },
      { id: 'sym:a#prop', kind: 'symbol', name: 'prop', path: 'a', exported: true }
    ],
    edges: [],
    namespaceImported: ['a']
  });
  assert.deepEqual(r, { bound: new Set([]), member: new Map([["sym:a#prop", "a is bound as a namespace or default object"], ["sym:a#default", "a is bound as a namespace or default object"]]) });
});

test('symbol not declared locally is resolved via star reexports', () => {
  const r = reexportReach({
    nodes: [
      { id: 'mod:a', kind: 'module', path: 'a' },
      { id: 'mod:b', kind: 'module', path: 'b' },
      { id: 'sym:b#z', kind: 'symbol', name: 'z', path: 'b', exported: true }
    ],
    edges: [
      { kind: 'reexports', from: 'mod:a', to: 'mod:b', star: true }
    ],
    namespaceImported: ['a']
  });
  assert.deepEqual(r, { bound: new Set([]), member: new Map([["sym:b#z", "a is bound as a namespace or default object"]]) });
});

test('namespace reexport surfaces the target module', () => {
  const r = reexportReach({
    nodes: [
      { id: 'mod:a', kind: 'module', path: 'a' },
      { id: 'mod:b', kind: 'module', path: 'b' },
      { id: 'sym:a#ns', kind: 'symbol', name: 'ns', path: 'a', exported: true },
      { id: 'sym:b#q', kind: 'symbol', name: 'q', path: 'b', exported: true }
    ],
    edges: [
      { kind: 'reexports', from: 'sym:a#ns', to: 'mod:b', namespace: true }
    ],
    namespaceImported: ['a']
  });
  assert.deepEqual(r, { bound: new Set([]), member: new Map([["sym:a#ns", "a is bound as a namespace or default object"], ["sym:b#q", "a#ns hands out b as a namespace object"]]) });
});

test('member reason is set only on first encounter', () => {
  const r = reexportReach({
    nodes: [
      { id: 'mod:a', kind: 'module', path: 'a' },
      { id: 'mod:b', kind: 'module', path: 'b' },
      { id: 'mod:c', kind: 'module', path: 'c' },
      { id: 'sym:a#x', kind: 'symbol', name: 'x', path: 'a', exported: true }
    ],
    edges: [
      { kind: 'reexports', from: 'mod:b', to: 'sym:a#x', star: false },
      { kind: 'reexports', from: 'mod:c', to: 'sym:a#x', star: false }
    ],
    namespaceImported: ['b', 'c']
  });
  assert.deepEqual(r, { bound: new Set([]), member: new Map([]) });
});
