// Computes the neighbourhood of a module path (codegraph/query.mjs neighbourhood).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neighbourhood } from '../query.mjs';

test('returns absent state when path is not in graph', () => {
  const g = { nodes: [], edges: [], files: { unreadable: [] } };
  assert.deepEqual(neighbourhood(g, 'missing.js'), { path: "missing.js", state: "absent", reason: "not in the analysed population" });
});

test('returns unreadable state when path is in unreadable files', () => {
  const g = { nodes: [], edges: [], files: { unreadable: [{ path: 'bad.js', reason: 'parse error' }] } };
  assert.deepEqual(neighbourhood(g, 'bad.js'), { path: "bad.js", state: "unreadable", reason: "parse error" });
});

test('returns analysed state with empty arrays for module with no edges or symbols', () => {
  const g = {
    nodes: [{ id: 'mod:a.js', kind: 'module', path: 'a.js', exports: [], surfaceComplete: true }],
    edges: [],
    files: { unreadable: [] }
  };
  assert.deepEqual(neighbourhood(g, 'a.js'), { path: "a.js", state: "analysed", exports: [], surfaceComplete: true, imports: [], importedBy: { static: [], dynamic: [], unknownFrom: [] }, reexports: [], defines: [] });
});

test('maps importsOut edges to import objects with dynamic and existence', () => {
  const g = {
    nodes: [
      { id: 'mod:a.js', kind: 'module', path: 'a.js', exports: [], surfaceComplete: true },
      { id: 'mod:b.js', kind: 'module', path: 'b.js', exports: [], surfaceComplete: true }
    ],
    edges: [
      { kind: 'imports', from: 'mod:a.js', to: 'mod:b.js', dynamic: true, existence: 'ok' },
      { kind: 'imports', from: 'mod:a.js', to: 'mod:c.js', dynamic: false, existence: 'missing' }
    ],
    files: { unreadable: [] }
  };
  assert.deepEqual(neighbourhood(g, 'a.js'), { path: "a.js", state: "analysed", exports: [], surfaceComplete: true, imports: [{ to: "mod:b.js", dynamic: true, existence: "ok" }, { to: "mod:c.js", dynamic: false, existence: "missing" }], importedBy: { static: [], dynamic: [], unknownFrom: [] }, reexports: [], defines: [] });
});

test('filters and sorts defines by line then name', () => {
  const g = {
    nodes: [
      { id: 'mod:a.js', kind: 'module', path: 'a.js', exports: [], surfaceComplete: true },
      { id: 'a.js#z', kind: 'symbol', path: 'a.js', name: 'z', symbolKind: 'function', line: 10, exported: true, witness: 'w1' },
      { id: 'a.js#a', kind: 'symbol', path: 'a.js', name: 'a', symbolKind: 'const', line: 5, exported: false, witness: 'w2' },
      { id: 'a.js#m', kind: 'symbol', path: 'a.js', name: 'm', symbolKind: 'function', line: 5, exported: true, witness: 'w3' }
    ],
    edges: [],
    files: { unreadable: [] }
  };
  assert.deepEqual(neighbourhood(g, 'a.js'), { path: "a.js", state: "analysed", exports: [], surfaceComplete: true, imports: [], importedBy: { static: [], dynamic: [], unknownFrom: [] }, reexports: [], defines: [{ name: "a", kind: "const", line: 5, exported: false, witness: "w2" }, { name: "m", kind: "function", line: 5, exported: true, witness: "w3" }, { name: "z", kind: "function", line: 10, exported: true, witness: "w1" }] });
});

test('maps reexports with star, namespace, and named forms', () => {
  const g = {
    nodes: [
      { id: 'mod:a.js', kind: 'module', path: 'a.js', exports: [], surfaceComplete: true },
      { id: 'mod:b.js', kind: 'module', path: 'b.js', exports: [], surfaceComplete: true },
      { id: 'mod:c.js', kind: 'module', path: 'c.js', exports: [], surfaceComplete: true }
    ],
    edges: [
      { kind: 'reexports', from: 'mod:b.js', to: 'mod:a.js', star: true, existence: 'ok' },
      { kind: 'reexports', from: 'mod:c.js#x', to: 'mod:a.js', star: false, namespace: true, existence: 'ok' },
      { kind: 'reexports', from: 'mod:c.js#y', to: 'mod:a.js', star: false, namespace: false, existence: 'missing' }
    ],
    files: { unreadable: [] }
  };
  assert.deepEqual(neighbourhood(g, 'a.js'), { path: "a.js", state: "analysed", exports: [], surfaceComplete: true, imports: [], importedBy: { static: [], dynamic: [], unknownFrom: [] }, reexports: [], defines: [] });
});

test('sorts reexports by name then to', () => {
  const g = {
    nodes: [
      { id: 'mod:a.js', kind: 'module', path: 'a.js', exports: [], surfaceComplete: true },
      { id: 'mod:b.js', kind: 'module', path: 'b.js', exports: [], surfaceComplete: true },
      { id: 'mod:c.js', kind: 'module', path: 'c.js', exports: [], surfaceComplete: true }
    ],
    edges: [
      { kind: 'reexports', from: 'mod:b.js#z', to: 'mod:a.js', star: false, namespace: false, existence: 'ok' },
      { kind: 'reexports', from: 'mod:b.js#a', to: 'mod:c.js', star: false, namespace: false, existence: 'ok' },
      { kind: 'reexports', from: 'mod:b.js#a', to: 'mod:a.js', star: false, namespace: false, existence: 'ok' }
    ],
    files: { unreadable: [] }
  };
  assert.deepEqual(neighbourhood(g, 'a.js'), { path: "a.js", state: "analysed", exports: [], surfaceComplete: true, imports: [], importedBy: { static: [], dynamic: [], unknownFrom: [] }, reexports: [], defines: [] });
});

test('handles undefined line in defines sorting', () => {
  const g = {
    nodes: [
      { id: 'mod:a.js', kind: 'module', path: 'a.js', exports: [], surfaceComplete: true },
      { id: 'a.js#b', kind: 'symbol', path: 'a.js', name: 'b', symbolKind: 'function', line: undefined, exported: true, witness: 'w1' },
      { id: 'a.js#a', kind: 'symbol', path: 'a.js', name: 'a', symbolKind: 'const', line: 0, exported: false, witness: 'w2' }
    ],
    edges: [],
    files: { unreadable: [] }
  };
  assert.deepEqual(neighbourhood(g, 'a.js'), { path: "a.js", state: "analysed", exports: [], surfaceComplete: true, imports: [], importedBy: { static: [], dynamic: [], unknownFrom: [] }, reexports: [], defines: [{ name: "a", kind: "const", line: 0, exported: false, witness: "w2" }, { name: "b", kind: "function", line: undefined, exported: true, witness: "w1" }] });
});
