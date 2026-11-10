// Exported symbols that no import reaches, split into dead and undetermined (codegraph/query.mjs deadExports).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deadExports } from '../query.mjs';

const sym = (path, name, line, extra = {}) => ({ id: `sym:${path}#${name}`, kind: 'symbol', path, name, exported: true, symbolKind: 'function', line, ...extra });
const mod = (path, extra = {}) => ({ id: `mod:${path}`, kind: 'module', path, ...extra });
const row = (s) => ({ id: s.id, path: s.path, name: s.name, symbolKind: s.symbolKind, line: s.line });
const graph = (nodes, extra = {}) => ({ nodes, edges: [], files: {}, ...extra });

test('an exported symbol that nothing imports is reported dead', () => {
  const x = sym('a.mjs', 'x', 1);
  const g = graph([mod('a.mjs', { surfaceComplete: true }), x]);
  assert.deepEqual(deadExports(g), { dead: [row(x)], undetermined: [], unknownFrom: [] });
});

test('a symbol that is not exported is never reported', () => {
  const y = sym('a.mjs', 'y', 2, { exported: false, symbolKind: 'const' });
  const g = graph([mod('a.mjs', { surfaceComplete: true }), y]);
  assert.deepEqual(deadExports(g), { dead: [], undetermined: [], unknownFrom: [] });
});

test('a symbol bound by an import is neither dead nor undetermined', () => {
  const x = sym('a.mjs', 'x', 1);
  const z = sym('a.mjs', 'z', 3);
  const g = graph([mod('a.mjs', { surfaceComplete: true }), x, z], {
    edges: [{ kind: 'binds', from: 'sym:b.mjs#x', to: 'sym:a.mjs#x' }],
  });
  assert.deepEqual(deadExports(g), { dead: [row(z)], undetermined: [], unknownFrom: [] });
});

test('exports of a module with an incomplete export star surface are undetermined', () => {
  const x = sym('a.mjs', 'x', 1);
  const g = graph([mod('a.mjs', { surfaceComplete: false, starReexports: ['b.mjs', 'c.mjs'] }), x]);
  assert.deepEqual(deadExports(g), {
    dead: [],
    undetermined: [{ ...row(x), why: 'module re-exports b.mjs, c.mjs with export *; its surface is not fully knowable here' }],
    unknownFrom: [],
  });
});

test('exports of a namespace imported module are undetermined for that reason', () => {
  const x = sym('a.mjs', 'x', 1);
  const g = graph([mod('a.mjs', { surfaceComplete: true }), x], { namespaceImported: ['a.mjs'] });
  assert.deepEqual(deadExports(g), {
    dead: [],
    undetermined: [{ ...row(x), why: 'module is bound as a namespace or default object; member access is not tracked' }],
    unknownFrom: [],
  });
});

test('exports of a dynamically imported module are undetermined for that reason', () => {
  const x = sym('a.mjs', 'x', 1);
  const g = graph([mod('a.mjs', { surfaceComplete: true }), x], { dynamicallyImported: ['a.mjs'] });
  assert.deepEqual(deadExports(g), {
    dead: [],
    undetermined: [{ ...row(x), why: 'module is reached by a dynamic import, which names no bindings' }],
    unknownFrom: [],
  });
});

test('an export re-exported by a namespace imported module is undetermined as a member', () => {
  const x = sym('a.mjs', 'x', 1);
  const g = graph([mod('a.mjs', { surfaceComplete: true }), x, mod('b.mjs')], {
    edges: [{ kind: 'reexports', from: 'sym:b.mjs#x', to: 'sym:a.mjs#x' }],
    namespaceImported: ['b.mjs'],
  });
  assert.deepEqual(deadExports(g), {
    dead: [],
    undetermined: [{ ...row(x), why: 'reached through a re-export: b.mjs is bound as a namespace or default object; member access is not tracked' }],
    unknownFrom: [],
  });
});

test('an unreadable file makes unimported exports undetermined and is listed', () => {
  const x = sym('a.mjs', 'x', 1);
  const g = graph([mod('a.mjs', { surfaceComplete: true }), x], {
    files: { unreadable: [{ path: 'z.mjs', reason: 'syntax error', size: 12 }] },
  });
  assert.deepEqual(deadExports(g), {
    dead: [],
    undetermined: [{ ...row(x), why: '1 file(s) could not be analysed and may import it' }],
    unknownFrom: [{ path: 'z.mjs', reason: 'syntax error' }],
  });
});

test('dead exports are sorted by path and then by name', () => {
  const y = sym('b.mjs', 'y', 4);
  const x = sym('b.mjs', 'x', 2);
  const w = sym('a.mjs', 'w', 9);
  const g = graph([y, x, w]);
  assert.deepEqual(deadExports(g), { dead: [row(w), row(x), row(y)], undetermined: [], unknownFrom: [] });
});

test('a graph without a files record throws a TypeError', () => {
  const g = { nodes: [sym('a.mjs', 'x', 1)], edges: [] };
  assert.throws(() => deadExports(g), { name: 'TypeError', message: "Cannot read properties of undefined (reading 'unreadable')" });
});
