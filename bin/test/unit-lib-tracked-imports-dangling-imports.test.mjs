// Reports relative import specifiers whose candidate paths are absent from the tracked set (bin/lib/tracked-imports.mjs danglingImports).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { danglingImports } from '../lib/tracked-imports.mjs';

test('returns empty array when no files are given', () => {
  const r = danglingImports([], () => '', new Set());
  assert.deepEqual(r, []);
});

test('returns empty array when the only import resolves to a tracked file', () => {
  const src = "import { A } from './dep.mjs';\n";
  const r = danglingImports(['a.mjs'], () => src, new Set(['a.mjs', 'dep.mjs']));
  assert.deepEqual(r, []);
});

test('reports a dangling static import with its candidate paths', () => {
  const src = "import { A } from './missing.mjs';\n";
  const r = danglingImports(['a.mjs'], () => src, new Set(['a.mjs']));
  assert.deepEqual(r, [{ file: "a.mjs", spec: "./missing.mjs", tried: ["missing.mjs", "missing.mjs.mjs", "missing.mjs.js", "missing.mjs/index.mjs", "missing.mjs/index.js"] }]);
});

test('reports a dangling dynamic import with its candidate paths', () => {
  const src = "const m = import('./dyn.mjs');\n";
  const r = danglingImports(['a.mjs'], () => src, new Set(['a.mjs']));
  assert.deepEqual(r, [{ file: "a.mjs", spec: "./dyn.mjs", tried: ["dyn.mjs", "dyn.mjs.mjs", "dyn.mjs.js", "dyn.mjs/index.mjs", "dyn.mjs/index.js"] }]);
});

test('reports a dangling relative export-from specifier', () => {
  const src = "export { B } from './gone.mjs';\n";
  const r = danglingImports(['a.mjs'], () => src, new Set(['a.mjs']));
  assert.deepEqual(r, [{ file: "a.mjs", spec: "./gone.mjs", tried: ["gone.mjs", "gone.mjs.mjs", "gone.mjs.js", "gone.mjs/index.mjs", "gone.mjs/index.js"] }]);
});

test('skips unreadable files without throwing', () => {
  const r = danglingImports(['gone.mjs'], () => { throw new Error('nope'); }, new Set());
  assert.deepEqual(r, []);
});

test('reports a dangling parent-directory import', () => {
  const src = "import { C } from '../up.mjs';\n";
  const r = danglingImports(['sub/a.mjs'], () => src, new Set(['sub/a.mjs']));
  assert.deepEqual(r, [{ file: "sub/a.mjs", spec: "../up.mjs", tried: ["up.mjs", "up.mjs.mjs", "up.mjs.js", "up.mjs/index.mjs", "up.mjs/index.js"] }]);
});

test('reports multiple dangling imports in one file', () => {
  const src = "import { A } from './x.mjs';\nimport { B } from './y.mjs';\n";
  const r = danglingImports(['a.mjs'], () => src, new Set(['a.mjs']));
  assert.deepEqual(r, [{ file: "a.mjs", spec: "./x.mjs", tried: ["x.mjs", "x.mjs.mjs", "x.mjs.js", "x.mjs/index.mjs", "x.mjs/index.js"] }, { file: "a.mjs", spec: "./y.mjs", tried: ["y.mjs", "y.mjs.mjs", "y.mjs.js", "y.mjs/index.mjs", "y.mjs/index.js"] }]);
});
