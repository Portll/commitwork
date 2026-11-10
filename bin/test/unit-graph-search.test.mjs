// Substring matches of graph nodes by id or label, plus kind and rel counts (bin/graph.mjs search).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../graph.mjs';

function tally(rows, key) {
  const m = new Map();
  for (const r of rows) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
  return [...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, n]) => ({ [key]: k, n }));
}

function makeDb(nodes, edges = [], calls = []) {
  return {
    prepare(sql) {
      if (sql.includes('GROUP BY kind')) return { all: () => tally(nodes, 'kind') };
      if (sql.includes('GROUP BY rel')) return { all: () => tally(edges, 'rel') };
      return {
        all(...args) {
          calls.push(args);
          const needle = args[2];
          return nodes
            .filter((n) => n.id.includes(needle) || n.label.includes(needle))
            .sort((a, b) => (b.id === needle) - (a.id === needle) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .slice(0, args[3])
            .map(({ id, kind, label }) => ({ id, kind, label }));
        },
      };
    },
  };
}

const seq = (n) => Array.from({ length: n }, (_, i) => ({ id: `n${String(i).padStart(2, '0')}`, kind: 'k', label: 'L' }));

test('an empty query returns zero matches with node and edge counts and skips the node query', () => {
  const calls = [];
  const db = makeDb(
    [{ id: 'a', kind: 'file', label: 'A' }, { id: 'b', kind: 'file', label: 'B' }, { id: 'c', kind: 'fn', label: 'C' }],
    [{ rel: 'imports' }, { rel: 'imports' }, { rel: 'calls' }],
    calls,
  );
  assert.deepEqual(search(db, ''), {
    q: '',
    counts: { nodes: { file: 2, fn: 1 }, edges: { calls: 1, imports: 2 } },
    count: 0,
    truncated: false,
    matches: [],
  });
  assert.deepEqual(calls, []);
});

test('whitespace, null and undefined queries are treated as empty', () => {
  const db = makeDb([]);
  const empty = { q: '', counts: { nodes: {}, edges: {} }, count: 0, truncated: false, matches: [] };
  assert.deepEqual(search(db, ' \t\n '), empty);
  assert.deepEqual(search(db, null), empty);
  assert.deepEqual(search(db, undefined), empty);
});

test('a trimmed query lists the exact id match first, then other id or label matches by id', () => {
  const calls = [];
  const db = makeDb([
    { id: 'xgraph', kind: 'file', label: 'X' },
    { id: 'graph', kind: 'mod', label: 'G' },
    { id: 'alpha', kind: 'file', label: 'graph helper' },
    { id: 'zeta', kind: 'file', label: 'Z' },
  ], [], calls);
  assert.deepEqual(search(db, '  graph  '), {
    q: 'graph',
    counts: { nodes: { file: 3, mod: 1 }, edges: {} },
    count: 3,
    truncated: false,
    limit: 50,
    matches: [
      { id: 'graph', kind: 'mod', label: 'G' },
      { id: 'alpha', kind: 'file', label: 'graph helper' },
      { id: 'xgraph', kind: 'file', label: 'X' },
    ],
  });
  assert.deepEqual(calls, [['%graph%', '%graph%', 'graph', 51]]);
});

test('backslash, percent and underscore are escaped in the LIKE pattern and no match gives empty matches', () => {
  const calls = [];
  const db = makeDb([{ id: 'abc', kind: 'k', label: 'xyz' }], [], calls);
  assert.deepEqual(search(db, 'a%b_c\\'), {
    q: 'a%b_c\\',
    counts: { nodes: { k: 1 }, edges: {} },
    count: 0,
    truncated: false,
    limit: 50,
    matches: [],
  });
  assert.deepEqual(calls, [['%a\\%b\\_c\\\\%', '%a\\%b\\_c\\\\%', 'a%b_c\\', 51]]);
});

test('one more matching row than the limit is cut to the limit and marked truncated', () => {
  const calls = [];
  const nodes = seq(4);
  assert.deepEqual(search(makeDb(nodes, [], calls), 'n', { limit: 3 }), {
    q: 'n',
    counts: { nodes: { k: 4 }, edges: {} },
    count: 3,
    truncated: true,
    limit: 3,
    matches: nodes.slice(0, 3),
  });
  assert.deepEqual(calls, [['%n%', '%n%', 'n', 4]]);
});

test('exactly as many matching rows as the limit is not truncated', () => {
  const nodes = seq(3);
  assert.deepEqual(search(makeDb(nodes), 'n', { limit: 3 }), {
    q: 'n',
    counts: { nodes: { k: 3 }, edges: {} },
    count: 3,
    truncated: false,
    limit: 3,
    matches: nodes,
  });
});

test('one fewer matching row than the limit returns every row untruncated', () => {
  const nodes = seq(2);
  assert.deepEqual(search(makeDb(nodes), 'n', { limit: 3 }), {
    q: 'n',
    counts: { nodes: { k: 2 }, edges: {} },
    count: 2,
    truncated: false,
    limit: 3,
    matches: nodes,
  });
});

test('the default limit of 50 truncates 51 matching rows to the first 50', () => {
  const nodes = seq(51);
  assert.deepEqual(search(makeDb(nodes), 'n'), {
    q: 'n',
    counts: { nodes: { k: 51 }, edges: {} },
    count: 50,
    truncated: true,
    limit: 50,
    matches: nodes.slice(0, 50),
  });
});
