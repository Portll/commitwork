// Computes which declarations are leaf-layer and their line counts (bin/module-seams.mjs leafLayer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leafLayer } from '../module-seams.mjs';

test('empty source yields zero declarations and zero lines', () => {
  const r = leafLayer('');
  assert.deepEqual(r, { total: 0, leaf: [], rest: [], leafLines: 0, restLines: 0 });
});

test('single declaration with no dependencies is a leaf', () => {
  const r = leafLayer('const a = 1;');
  assert.deepEqual(r, { total: 1, leaf: [{ name: "a", at: 0, body: "const a = 1;", deps: new Set([]) }], rest: [], leafLines: 1, restLines: 0 });
});

test('declaration depending on another declaration is not a leaf', () => {
  const r = leafLayer('const a = 1;\nconst b = a;');
  assert.deepEqual(r, { total: 2, leaf: [{ name: "a", at: 0, body: "const a = 1;\n", deps: new Set([]) }, { name: "b", at: 13, body: "const b = a;", deps: new Set(["a"]) }], rest: [], leafLines: 3, restLines: 0 });
});

test('two independent declarations are both leaves', () => {
  const r = leafLayer('const a = 1;\nconst b = 2;');
  assert.deepEqual(r, { total: 2, leaf: [{ name: "a", at: 0, body: "const a = 1;\n", deps: new Set([]) }, { name: "b", at: 13, body: "const b = 2;", deps: new Set([]) }], rest: [], leafLines: 3, restLines: 0 });
});

test('circular dependencies leave no declarations as leaves', () => {
  const r = leafLayer('const a = b;\nconst b = a;');
  assert.deepEqual(r, { total: 2, leaf: [], rest: [{ name: "a", at: 0, body: "const a = b;\n", deps: new Set(["b"]) }, { name: "b", at: 13, body: "const b = a;", deps: new Set(["a"]) }], leafLines: 0, restLines: 3 });
});

test('multi-line leaf body counts its lines correctly', () => {
  const r = leafLayer('const a = 1;\nconst b = 2;\nconst c = 3;');
  assert.deepEqual(r, { total: 3, leaf: [{ name: "a", at: 0, body: "const a = 1;\n", deps: new Set([]) }, { name: "b", at: 13, body: "const b = 2;\n", deps: new Set([]) }, { name: "c", at: 26, body: "const c = 3;", deps: new Set([]) }], rest: [], leafLines: 5, restLines: 0 });
});

test('exported function with no internal deps is a leaf', () => {
  const r = leafLayer('export function foo() { return 1; }');
  assert.deepEqual(r, { total: 1, leaf: [{ name: "foo", at: 0, body: "export function foo() { return 1; }", deps: new Set([]) }], rest: [], leafLines: 1, restLines: 0 });
});

test('declaration referencing external identifier is still a leaf', () => {
  const r = leafLayer('const a = Math.PI;');
  assert.deepEqual(r, { total: 1, leaf: [{ name: "a", at: 0, body: "const a = Math.PI;", deps: new Set([]) }], rest: [], leafLines: 1, restLines: 0 });
});
