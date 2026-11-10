// Sorted veld memory records for a graph's symbol nodes (codegraph/veld.mjs records).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { records } from '../veld.mjs';

const sym = (name, path, exported, symbolKind = 'function') => ({
  id: `sym:${path}#${name}`, kind: 'symbol', name, path, exported, symbolKind, witness: 'lexical',
});
const mod = (path, exports, exported) => ({ id: `mod:${path}`, kind: 'module', path, exports, exported });
const names = (rs) => rs.map((r) => r.content.split(' ')[1]);
const ids = (rs) => rs.map((r) => r.external_id.slice(r.external_id.indexOf('repoQ:')));
const headTail = (r) => r.content.slice(r.content.indexOf('] ') + 2, r.content.indexOf('\n'));
const MSG = 'records: a repo identifier is required \u2014 a locator without one locates nothing';

test('a missing or empty repo identifier throws the locator error', () => {
  const graph = { nodes: [sym('foo', 'a.mjs', true)], edges: [] };
  assert.throws(() => records(graph, {}), { name: 'Error', message: MSG });
  assert.throws(() => records(graph), { name: 'Error', message: MSG });
  assert.throws(() => records(graph, { repo: '' }), { name: 'Error', message: MSG });
});

test('by default only exported symbols become records', () => {
  const graph = {
    nodes: [mod('a.mjs', ['foo']), sym('foo', 'a.mjs', true), sym('bar', 'a.mjs', false)],
    edges: [],
  };
  const result = records(graph, { repo: 'repoQ' });
  assert.deepEqual(names(result), ['foo']);
  assert.deepEqual(ids(result), ['repoQ:a.mjs#foo']);
});

test('with only set to all internal symbols are kept but non-symbol nodes are not', () => {
  const graph = {
    nodes: [mod('a.mjs', ['foo']), sym('foo', 'a.mjs', true), sym('bar', 'a.mjs', false)],
    edges: [],
  };
  const result = records(graph, { repo: 'repoQ', only: 'all' });
  assert.deepEqual(names(result), ['bar', 'foo']);
  assert.deepEqual(ids(result), ['repoQ:a.mjs#bar', 'repoQ:a.mjs#foo']);
});

test('a non-symbol node marked exported is still left out by default', () => {
  const graph = {
    nodes: [mod('a.mjs', ['foo'], true), sym('foo', 'a.mjs', true)],
    edges: [],
  };
  const result = records(graph, { repo: 'repoQ' });
  assert.deepEqual(names(result), ['foo']);
});

test('an unrecognised only value behaves like the exported default', () => {
  const graph = {
    nodes: [sym('foo', 'a.mjs', true), sym('bar', 'a.mjs', false)],
    edges: [],
  };
  const result = records(graph, { repo: 'repoQ', only: 'everything' });
  assert.deepEqual(names(result), ['foo']);
});

test('records are sorted by external id regardless of node order', () => {
  const graph = {
    nodes: [sym('zeta', 'b.mjs', true), sym('alpha', 'a.mjs', true)],
    edges: [],
  };
  const result = records(graph, { repo: 'repoQ' });
  assert.deepEqual(ids(result), ['repoQ:a.mjs#alpha', 'repoQ:b.mjs#zeta']);
  assert.deepEqual(names(result), ['alpha', 'zeta']);
});

test('each record carries the Context type and path and kind tags', () => {
  const graph = {
    nodes: [sym('Widget', 'w.mjs', true, 'class'), sym('make', 'm.mjs', true)],
    edges: [],
  };
  const result = records(graph, { repo: 'repoQ' });
  assert.deepEqual(result.map((r) => [r.memory_type, r.tags]), [
    ['Context', ['codegraph', 'codegraph-path:m.mjs', 'codegraph-kind:function']],
    ['Context', ['codegraph', 'codegraph-path:w.mjs', 'codegraph-kind:class']],
  ]);
});

test('a commit is shortened to seven characters in the record head', () => {
  const graph = { nodes: [sym('foo', 'a.mjs', true)], edges: [] };
  const result = records(graph, { repo: 'repoQ', commit: 'abcdef1234567890' });
  assert.equal(
    headTail(result[0]),
    '\u2014 a function in a.mjs at commit abcdef1. Exported, 0 importer(s) bind it, 0 call site(s). '
      + 'LOCATOR not content: read a.mjs; node codegraph/report.mjs about a.mjs',
  );
});

test('an internal symbol without a commit is described as Internal with no commit', () => {
  const graph = { nodes: [sym('bar', 'a.mjs', false)], edges: [] };
  const result = records(graph, { repo: 'repoQ', only: 'all' });
  assert.equal(
    headTail(result[0]),
    '\u2014 a function in a.mjs. Internal, 0 importer(s) bind it, 0 call site(s). '
      + 'LOCATOR not content: read a.mjs; node codegraph/report.mjs about a.mjs',
  );
});

test('a graph with no nodes yields an empty list', () => {
  assert.deepEqual(records({ nodes: [], edges: [] }, { repo: 'repoQ' }), []);
});
