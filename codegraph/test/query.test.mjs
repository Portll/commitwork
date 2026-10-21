// The answers, and the uncertainty each one is required to carry with it.
//
// Hand-built graphs, deliberately: these assertions are about what query.mjs does with a
// population, not about whether the extractors read one correctly. Mixing the two would let a
// change in either pass by borrowing the other's coverage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  index, importers, blastRadius, deadExports, callersOf, entryPoints, neighbourhood, unknownFrom,
} from '../query.mjs';

const mod = (path, extra = {}) => ({ v: 1, id: `mod:${path}`, kind: 'module', path, exports: [], surfaceComplete: true, starReexports: [], ...extra });
const sym = (path, name, extra = {}) => ({ v: 1, id: `sym:${path}#${name}`, kind: 'symbol', path, name, symbolKind: 'function', line: 1, exported: true, witness: 'both', ...extra });
const edge = (from, to, kind, extra = {}) => ({ v: 1, from, to, kind, witness: 'lexical', existence: 'confirmed', evidence: null, ...extra });

const graph = (over = {}) => ({
  v: 1,
  generatedAt: '2026-09-04T00:00:00.000Z',
  source: 'worktree',
  dynamicallyImported: [],
  namespaceImported: [],
  files: { input: 0, analysed: [], partial: [], unreadable: [] },
  nodes: [],
  edges: [],
  summary: {},
  ...over,
});

test('a reachability answer with a hole in the population says so, in a FIELD', () => {
  const clean = graph({ nodes: [mod('a.mjs')], files: { input: 1, analysed: ['a.mjs'], partial: [], unreadable: [] } });
  assert.equal(blastRadius(clean, 'a.mjs').lowerBound, false);
  assert.deepEqual(unknownFrom(clean), []);

  const holed = graph({
    nodes: [mod('a.mjs')],
    files: { input: 2, analysed: ['a.mjs'], partial: [], unreadable: [{ path: 'b.mjs', reason: 'lexer bailed: unterminated string' }] },
  });
  const r = blastRadius(holed, 'a.mjs');
  assert.equal(r.lowerBound, true, 'a file nobody could read may import anything');
  assert.deepEqual(r.unknownFrom.map((u) => u.path), ['b.mjs']);
});

test('blast radius is transitive and carries the depth it was reached at', () => {
  const g = graph({
    nodes: [mod('core.mjs'), mod('mid.mjs'), mod('top.mjs'), mod('unrelated.mjs')],
    edges: [
      edge('mod:mid.mjs', 'mod:core.mjs', 'imports'),
      edge('mod:top.mjs', 'mod:mid.mjs', 'imports'),
    ],
  });
  assert.deepEqual(blastRadius(g, 'core.mjs').reached,
    [{ path: 'mid.mjs', depth: 1 }, { path: 'top.mjs', depth: 2 }]);
  assert.deepEqual(blastRadius(g, 'core.mjs', { maxDepth: 1 }).reached, [{ path: 'mid.mjs', depth: 1 }],
    'maxDepth truncates the walk and the result says which depth each row came from');
  assert.deepEqual(blastRadius(g, 'unrelated.mjs').reached, []);
});

test('a cycle terminates rather than walking forever', () => {
  const g = graph({
    nodes: [mod('a.mjs'), mod('b.mjs')],
    edges: [edge('mod:a.mjs', 'mod:b.mjs', 'imports'), edge('mod:b.mjs', 'mod:a.mjs', 'imports')],
  });
  assert.deepEqual(blastRadius(g, 'a.mjs').reached, [{ path: 'b.mjs', depth: 1 }]);
});

test('static and dynamic importers are different facts and are returned apart', () => {
  const g = graph({
    nodes: [mod('lib.mjs'), mod('s.mjs'), mod('d.mjs')],
    edges: [
      edge('mod:s.mjs', 'mod:lib.mjs', 'imports'),
      edge('mod:d.mjs', 'mod:lib.mjs', 'imports', { existence: 'unknown', dynamic: true }),
    ],
  });
  const r = importers(g, 'lib.mjs');
  assert.deepEqual(r.static, ['s.mjs']);
  assert.deepEqual(r.dynamic, ['d.mjs']);
});

test('deadExports keeps dead and undetermined apart, and never merges them', () => {
  const base = {
    nodes: [mod('lib.mjs', { exports: ['used', 'unused'] }), mod('app.mjs'), sym('lib.mjs', 'used'), sym('lib.mjs', 'unused')],
    edges: [edge('mod:app.mjs', 'sym:lib.mjs#used', 'binds')],
  };
  const clean = deadExports(graph(base));
  assert.deepEqual(clean.dead.map((d) => d.name), ['unused']);
  assert.deepEqual(clean.undetermined, []);

  const namespaced = deadExports(graph({ ...base, namespaceImported: ['lib.mjs'] }));
  assert.deepEqual(namespaced.dead, [], 'a namespace binding reaches every export by member access');
  assert.deepEqual(namespaced.undetermined.map((d) => d.name), ['unused']);
  assert.match(namespaced.undetermined[0].why, /namespace or default object/);

  const starred = deadExports(graph({
    ...base,
    nodes: [mod('lib.mjs', { exports: ['used', 'unused'], surfaceComplete: false, starReexports: ['./other.mjs'] }),
      mod('app.mjs'), sym('lib.mjs', 'used'), sym('lib.mjs', 'unused')],
  }));
  assert.deepEqual(starred.dead, []);
  assert.match(starred.undetermined[0].why, /export \*/);
});

// A re-export, as codegraph/build.mjs emits it: from the exported name to what it resolves to.
const reex = (from, to, extra = {}) => edge(from, to, 'reexports', { witness: 'both', ...extra });
const deadNames = (r) => r.dead.map((d) => d.id.slice(4)).sort();
const undeterminedNames = (r) => r.undetermined.map((d) => d.id.slice(4)).sort();

test('a binding through a named or renamed re-export is a use of the original; an unbound re-export is not', () => {
  const g = graph({
    nodes: [mod('b.mjs'), mod('a.mjs'), mod('c.mjs'),
      sym('b.mjs', 'x'), sym('b.mjs', 'y'), sym('b.mjs', 'z'),
      sym('a.mjs', 'xx', { symbolKind: 'reexport' }), sym('a.mjs', 'y', { symbolKind: 'reexport' })],
    edges: [
      reex('sym:a.mjs#xx', 'sym:b.mjs#x'),
      reex('sym:a.mjs#y', 'sym:b.mjs#y'),
      edge('mod:c.mjs', 'sym:a.mjs#xx', 'binds'),
    ],
  });
  const r = deadExports(g);
  assert.deepEqual(deadNames(r), ['a.mjs#y', 'b.mjs#y', 'b.mjs#z'],
    'b#x is used through the rename; b#y is re-exported and nobody binds the re-export, so both stay dead');
  assert.deepEqual(r.undetermined, []);
});

test('a re-export chain is followed to its end, and a cycle of them terminates', () => {
  const g = graph({
    nodes: [mod('c.mjs'), mod('b.mjs'), mod('a.mjs'), mod('p.mjs'), mod('q.mjs'), mod('app.mjs'),
      sym('c.mjs', 'deep'), sym('c.mjs', 'unused'),
      sym('b.mjs', 'deep', { symbolKind: 'reexport' }), sym('a.mjs', 'top', { symbolKind: 'reexport' }),
      sym('p.mjs', 'loop', { symbolKind: 'reexport' }), sym('q.mjs', 'loop', { symbolKind: 'reexport' })],
    edges: [
      reex('sym:a.mjs#top', 'sym:b.mjs#deep'),
      reex('sym:b.mjs#deep', 'sym:c.mjs#deep'),
      edge('mod:app.mjs', 'sym:a.mjs#top', 'binds'),
      reex('sym:p.mjs#loop', 'sym:q.mjs#loop'),
      reex('sym:q.mjs#loop', 'sym:p.mjs#loop'),
      edge('mod:app.mjs', 'sym:p.mjs#loop', 'binds'),
    ],
  });
  const r = deadExports(g);
  assert.deepEqual(deadNames(r), ['c.mjs#unused'], 'A → B → C reaches C; the cycle is walked once and ends');
});

test('export * carries a binding to the module that has the name, and never carries default', () => {
  const g = graph({
    nodes: [mod('a.mjs', { exports: ['own'], surfaceComplete: false, starReexports: ['./b.mjs'] }),
      mod('b.mjs'), mod('c.mjs'), mod('app.mjs'),
      sym('a.mjs', 'own'), sym('b.mjs', 'n'), sym('b.mjs', 'm'), sym('b.mjs', 'default'),
      sym('b.mjs', 'far', { symbolKind: 'reexport' }), sym('c.mjs', 'far'), sym('c.mjs', 'near')],
    edges: [
      reex('mod:a.mjs', 'mod:b.mjs', { star: true }),
      reex('sym:b.mjs#far', 'sym:c.mjs#far'),
      edge('mod:app.mjs', 'sym:a.mjs#n', 'binds', { existence: 'unknown' }),
      edge('mod:app.mjs', 'sym:a.mjs#far', 'binds', { existence: 'unknown' }),
      edge('mod:app.mjs', 'sym:a.mjs#default', 'binds', { existence: 'unknown' }),
    ],
  });
  const r = deadExports(g);
  assert.deepEqual(deadNames(r), ['b.mjs#default', 'b.mjs#m', 'c.mjs#near'],
    'n and far arrive through the star (far one hop further); m and near do not; a star skips default');
  assert.deepEqual(undeterminedNames(r), ['a.mjs#own'], 'the starring module itself keeps its existing rule');
});

test('export * as ns: binding the namespace makes its target undetermined; leaving it unbound does not', () => {
  const nodes = [mod('a.mjs'), mod('b.mjs'), mod('app.mjs'),
    sym('a.mjs', 'ns', { symbolKind: 'reexport' }), sym('b.mjs', 'x')];
  const edges = [reex('sym:a.mjs#ns', 'mod:b.mjs', { namespace: true })];
  const bound = deadExports(graph({ nodes, edges: [...edges, edge('mod:app.mjs', 'sym:a.mjs#ns', 'binds')] }));
  assert.deepEqual(bound.dead, [], 'a namespace object reaches every export by member access');
  assert.deepEqual(undeterminedNames(bound), ['b.mjs#x']);
  assert.match(bound.undetermined[0].why, /reached through a re-export: a\.mjs#ns hands out b\.mjs as a namespace object/);

  const unbound = deadExports(graph({ nodes, edges }));
  assert.deepEqual(deadNames(unbound), ['a.mjs#ns', 'b.mjs#x'], 'nobody took the namespace, so nothing reaches b through it');
  assert.deepEqual(unbound.undetermined, []);
});

test('a namespace or dynamic import of a re-exporting module leaves what it re-exports undetermined', () => {
  const nodes = [mod('a.mjs'), mod('b.mjs'), mod('s.mjs'),
    sym('a.mjs', 'x', { symbolKind: 'reexport' }), sym('b.mjs', 'x'), sym('b.mjs', 'other'),
    sym('s.mjs', 'q'), sym('s.mjs', 'default')];
  const edges = [reex('sym:a.mjs#x', 'sym:b.mjs#x'), reex('mod:a.mjs', 'mod:s.mjs', { star: true })];
  for (const [field, why] of [['namespaceImported', /namespace or default object/], ['dynamicallyImported', /dynamic import/]]) {
    const r = deadExports(graph({ nodes, edges, [field]: ['a.mjs'] }));
    assert.deepEqual(undeterminedNames(r), ['a.mjs#x', 'b.mjs#x', 's.mjs#q'], `${field}: x behind the name, q behind the star`);
    assert.match(r.undetermined.find((u) => u.id === 'sym:b.mjs#x').why, /^reached through a re-export: a\.mjs is/);
    assert.match(r.undetermined.find((u) => u.id === 'sym:b.mjs#x').why, why);
    assert.deepEqual(deadNames(r), ['b.mjs#other', 's.mjs#default'],
      `${field}: what no re-export hands out stays dead, and a star never hands out default`);
  }
});

test('a default object reached through a re-export protects its members like a direct one', () => {
  const r = deadExports(graph({
    nodes: [mod('a.mjs'), mod('b.mjs', { defaultObjectLiteral: true }), mod('app.mjs'),
      sym('a.mjs', 'default', { symbolKind: 'reexport' }), sym('b.mjs', 'default'), sym('b.mjs', 'member')],
    edges: [reex('sym:a.mjs#default', 'sym:b.mjs#default'), edge('mod:app.mjs', 'sym:a.mjs#default', 'binds')],
  }));
  assert.deepEqual(r.dead, []);
  assert.deepEqual(undeterminedNames(r), ['b.mjs#member']);
  assert.match(r.undetermined[0].why, /default export is an object literal/);
});

test('about names what each re-export resolves to', () => {
  const g = graph({
    nodes: [mod('a.mjs', { exports: ['y'] }), mod('b.mjs'), sym('a.mjs', 'y', { symbolKind: 'reexport' })],
    edges: [reex('sym:a.mjs#y', 'sym:b.mjs#x'), reex('mod:a.mjs', 'mod:b.mjs', { star: true })],
  });
  assert.deepEqual(neighbourhood(g, 'a.mjs').reexports, [
    { name: '*', to: 'mod:b.mjs', how: 'star', existence: 'confirmed' },
    { name: 'y', to: 'sym:b.mjs#x', how: 'named', existence: 'confirmed' },
  ]);
});

test('an unexported symbol is never a dead EXPORT', () => {
  const g = graph({ nodes: [mod('lib.mjs'), sym('lib.mjs', 'helper', { exported: false })] });
  assert.deepEqual(deadExports(g).dead, [], 'an internal helper is not part of any surface');
});

test('entryPoints are the modules nothing imports', () => {
  const g = graph({
    nodes: [mod('lib.mjs'), mod('cli.mjs')],
    edges: [edge('mod:cli.mjs', 'mod:lib.mjs', 'imports')],
  });
  assert.deepEqual(entryPoints(g), ['cli.mjs']);
});

test('callersOf returns the evidence, and the evidence is where the id is not', () => {
  const g = graph({
    nodes: [mod('a.mjs'), sym('a.mjs', 'target')],
    edges: [edge('sym:a.mjs#caller', 'sym:a.mjs#target', 'calls', { evidence: 'a.mjs:42' })],
  });
  const rows = callersOf(g, 'sym:a.mjs#target');
  assert.deepEqual(rows, [{ from: 'sym:a.mjs#caller', evidence: 'a.mjs:42' }]);
  assert.ok(!rows[0].from.includes('42'), 'the line lives in the evidence and never in the identity');
});

test('neighbourhood distinguishes analysed, unreadable and absent', () => {
  const g = graph({
    nodes: [mod('a.mjs', { exports: ['x'] }), sym('a.mjs', 'x')],
    files: { input: 2, analysed: ['a.mjs'], partial: [], unreadable: [{ path: 'b.mjs', reason: 'lexer bailed: x' }] },
  });
  assert.equal(neighbourhood(g, 'a.mjs').state, 'analysed');
  assert.equal(neighbourhood(g, 'b.mjs').state, 'unreadable');
  assert.equal(neighbourhood(g, 'nowhere.mjs').state, 'absent',
    'not in the population is not the same as read and found empty');
});

test('the index is reusable across queries and does not change an answer', () => {
  const g = graph({
    nodes: [mod('lib.mjs'), mod('app.mjs')],
    edges: [edge('mod:app.mjs', 'mod:lib.mjs', 'imports')],
  });
  const ix = index(g);
  assert.deepEqual(importers(g, 'lib.mjs', ix), importers(g, 'lib.mjs'));
  assert.deepEqual(blastRadius(g, 'lib.mjs', { ix }), blastRadius(g, 'lib.mjs'));
});
