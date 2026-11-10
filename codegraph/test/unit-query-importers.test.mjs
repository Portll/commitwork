// Maps a module path to the sorted lists of static and dynamic importers plus unreadable files (codegraph/query.mjs importers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importers } from '../query.mjs';

test('returns empty static and dynamic lists when no module imports the path', () => {
  const graph = {
    nodes: [
      { id: 'mod:src/a.mjs', kind: 'module', path: 'src/a.mjs' },
      { id: 'mod:src/b.mjs', kind: 'module', path: 'src/b.mjs' }
    ],
    edges: [
      { kind: 'imports', from: 'mod:src/a.mjs', to: 'mod:src/c.mjs', dynamic: false }
    ],
    files: { unreadable: [] }
  };
  const r = importers(graph, 'src/b.mjs');
  assert.deepEqual(r, { static: [], dynamic: [], unknownFrom: [] });
});

test('returns sorted static importers when multiple modules import the path statically', () => {
  const graph = {
    nodes: [
      { id: 'mod:src/z.mjs', kind: 'module', path: 'src/z.mjs' },
      { id: 'mod:src/a.mjs', kind: 'module', path: 'src/a.mjs' },
      { id: 'mod:src/m.mjs', kind: 'module', path: 'src/m.mjs' },
      { id: 'mod:src/target.mjs', kind: 'module', path: 'src/target.mjs' }
    ],
    edges: [
      { kind: 'imports', from: 'mod:src/z.mjs', to: 'mod:src/target.mjs', dynamic: false },
      { kind: 'imports', from: 'mod:src/a.mjs', to: 'mod:src/target.mjs', dynamic: false },
      { kind: 'imports', from: 'mod:src/m.mjs', to: 'mod:src/target.mjs', dynamic: false }
    ],
    files: { unreadable: [] }
  };
  const r = importers(graph, 'src/target.mjs');
  assert.deepEqual(r, { static: ["src/a.mjs", "src/m.mjs", "src/z.mjs"], dynamic: [], unknownFrom: [] });
});

test('returns sorted dynamic importers when modules import the path dynamically', () => {
  const graph = {
    nodes: [
      { id: 'mod:src/b.mjs', kind: 'module', path: 'src/b.mjs' },
      { id: 'mod:src/c.mjs', kind: 'module', path: 'src/c.mjs' },
      { id: 'mod:src/target.mjs', kind: 'module', path: 'src/target.mjs' }
    ],
    edges: [
      { kind: 'imports', from: 'mod:src/b.mjs', to: 'mod:src/target.mjs', dynamic: true },
      { kind: 'imports', from: 'mod:src/c.mjs', to: 'mod:src/target.mjs', dynamic: true }
    ],
    files: { unreadable: [] }
  };
  const r = importers(graph, 'src/target.mjs');
  assert.deepEqual(r, { static: [], dynamic: ["src/b.mjs", "src/c.mjs"], unknownFrom: [] });
});

test('deduplicates repeated importers of the same kind', () => {
  const graph = {
    nodes: [
      { id: 'mod:src/a.mjs', kind: 'module', path: 'src/a.mjs' },
      { id: 'mod:src/target.mjs', kind: 'module', path: 'src/target.mjs' }
    ],
    edges: [
      { kind: 'imports', from: 'mod:src/a.mjs', to: 'mod:src/target.mjs', dynamic: false },
      { kind: 'imports', from: 'mod:src/a.mjs', to: 'mod:src/target.mjs', dynamic: false }
    ],
    files: { unreadable: [] }
  };
  const r = importers(graph, 'src/target.mjs');
  assert.deepEqual(r, { static: ["src/a.mjs"], dynamic: [], unknownFrom: [] });
});

test('returns unreadable file entries in the unknownFrom field', () => {
  const graph = {
    nodes: [
      { id: 'mod:src/a.mjs', kind: 'module', path: 'src/a.mjs' },
      { id: 'mod:src/target.mjs', kind: 'module', path: 'src/target.mjs' }
    ],
    edges: [
      { kind: 'imports', from: 'mod:src/a.mjs', to: 'mod:src/target.mjs', dynamic: false }
    ],
    files: { unreadable: [{ path: 'src/broken.mjs', reason: 'ENOENT' }] }
  };
  const r = importers(graph, 'src/target.mjs');
  assert.deepEqual(r, { static: ["src/a.mjs"], dynamic: [], unknownFrom: [{ path: "src/broken.mjs", reason: "ENOENT" }] });
});

test('separates static and dynamic importers when both kinds exist', () => {
  const graph = {
    nodes: [
      { id: 'mod:src/s1.mjs', kind: 'module', path: 'src/s1.mjs' },
      { id: 'mod:src/d1.mjs', kind: 'module', path: 'src/d1.mjs' },
      { id: 'mod:src/target.mjs', kind: 'module', path: 'src/target.mjs' }
    ],
    edges: [
      { kind: 'imports', from: 'mod:src/s1.mjs', to: 'mod:src/target.mjs', dynamic: false },
      { kind: 'imports', from: 'mod:src/d1.mjs', to: 'mod:src/target.mjs', dynamic: true }
    ],
    files: { unreadable: [] }
  };
  const r = importers(graph, 'src/target.mjs');
  assert.deepEqual(r, { static: ["src/s1.mjs"], dynamic: ["src/d1.mjs"], unknownFrom: [] });
});
