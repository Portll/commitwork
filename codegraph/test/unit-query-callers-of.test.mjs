// Returns sorted caller edges for a symbol (codegraph/query.mjs callersOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callersOf } from '../query.mjs';

test('returns empty array when no calls target the symbol', () => {
  const graph = {
    nodes: [
      { id: 'sym:foo#bar', kind: 'symbol', path: 'foo' },
      { id: 'sym:baz#qux', kind: 'symbol', path: 'baz' }
    ],
    edges: []
  };
  assert.deepEqual(callersOf(graph, 'sym:foo#bar'), []);
});

test('returns single caller when one call edge targets the symbol', () => {
  const graph = {
    nodes: [
      { id: 'sym:foo#bar', kind: 'symbol', path: 'foo' },
      { id: 'sym:baz#qux', kind: 'symbol', path: 'baz' }
    ],
    edges: [
      { kind: 'calls', from: 'sym:baz#qux', to: 'sym:foo#bar', evidence: 'line 10' }
    ]
  };
  assert.deepEqual(callersOf(graph, 'sym:foo#bar'), [{ from: "sym:baz#qux", evidence: "line 10" }]);
});

test('returns multiple callers sorted by from id', () => {
  const graph = {
    nodes: [
      { id: 'sym:foo#bar', kind: 'symbol', path: 'foo' },
      { id: 'sym:zeta#alpha', kind: 'symbol', path: 'zeta' },
      { id: 'sym:beta#gamma', kind: 'symbol', path: 'beta' },
      { id: 'sym:alpha#delta', kind: 'symbol', path: 'alpha' }
    ],
    edges: [
      { kind: 'calls', from: 'sym:zeta#alpha', to: 'sym:foo#bar', evidence: 'e1' },
      { kind: 'calls', from: 'sym:beta#gamma', to: 'sym:foo#bar', evidence: 'e2' },
      { kind: 'calls', from: 'sym:alpha#delta', to: 'sym:foo#bar', evidence: 'e3' }
    ]
  };
  assert.deepEqual(callersOf(graph, 'sym:foo#bar'), [{ from: "sym:alpha#delta", evidence: "e3" }, { from: "sym:beta#gamma", evidence: "e2" }, { from: "sym:zeta#alpha", evidence: "e1" }]);
});

test('returns empty array when calls target a different symbol', () => {
  const graph = {
    nodes: [
      { id: 'sym:foo#bar', kind: 'symbol', path: 'foo' },
      { id: 'sym:baz#qux', kind: 'symbol', path: 'baz' }
    ],
    edges: [
      { kind: 'calls', from: 'sym:baz#qux', to: 'sym:other#thing', evidence: 'e1' }
    ]
  };
  assert.deepEqual(callersOf(graph, 'sym:foo#bar'), []);
});

test('returns empty array for unknown symbol id', () => {
  const graph = {
    nodes: [
      { id: 'sym:foo#bar', kind: 'symbol', path: 'foo' }
    ],
    edges: [
      { kind: 'calls', from: 'sym:baz#qux', to: 'sym:foo#bar', evidence: 'e1' }
    ]
  };
  assert.deepEqual(callersOf(graph, 'sym:unknown#id'), []);
});

test('ignores non-call edges when computing callers', () => {
  const graph = {
    nodes: [
      { id: 'sym:foo#bar', kind: 'symbol', path: 'foo' },
      { id: 'sym:baz#qux', kind: 'symbol', path: 'baz' }
    ],
    edges: [
      { kind: 'imports', from: 'sym:baz#qux', to: 'sym:foo#bar', evidence: 'imp' },
      { kind: 'binds', from: 'sym:baz#qux', to: 'sym:foo#bar', evidence: 'bind' }
    ]
  };
  assert.deepEqual(callersOf(graph, 'sym:foo#bar'), []);
});

test('returns callers with evidence preserved from edges', () => {
  const graph = {
    nodes: [
      { id: 'sym:foo#bar', kind: 'symbol', path: 'foo' },
      { id: 'sym:aaa#bbb', kind: 'symbol', path: 'aaa' },
      { id: 'sym:ccc#ddd', kind: 'symbol', path: 'ccc' }
    ],
    edges: [
      { kind: 'calls', from: 'sym:aaa#bbb', to: 'sym:foo#bar', evidence: 'call at 5' },
      { kind: 'calls', from: 'sym:ccc#ddd', to: 'sym:foo#bar', evidence: 'call at 9' }
    ]
  };
  assert.deepEqual(callersOf(graph, 'sym:foo#bar'), [{ from: "sym:aaa#bbb", evidence: "call at 5" }, { from: "sym:ccc#ddd", evidence: "call at 9" }]);
});
