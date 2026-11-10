// Reports named imports that are not present in the target module's export surface (bin/lib/tracked-imports.mjs missingExports).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingExports } from '../lib/tracked-imports.mjs';

test('reports a named import that the target does not export', () => {
  const files = ['a/b.js'];
  const tracked = new Set(['a/b.js', 'a/c.js']);
  const readFile = (p) => {
    if (p === 'a/b.js') return "import { x, y } from './c.js';\n";
    if (p === 'a/c.js') return "export const x = 1;\n";
    throw new Error('no such file: ' + p);
  };
  assert.deepEqual(missingExports(files, readFile, tracked), [{ file: "a/b.js", spec: "./c.js", name: "y", target: "a/c.js" }]);
});

test('reports nothing when every imported name is exported by the target', () => {
  const files = ['a/b.js'];
  const tracked = new Set(['a/b.js', 'a/c.js']);
  const readFile = (p) => {
    if (p === 'a/b.js') return "import { x } from './c.js';\n";
    if (p === 'a/c.js') return "export const x = 1;\n";
    throw new Error('no such file: ' + p);
  };
  assert.deepEqual(missingExports(files, readFile, tracked), []);
});

test('skips a target whose surface is a star re-export', () => {
  const files = ['a/b.js'];
  const tracked = new Set(['a/b.js', 'a/c.js']);
  const readFile = (p) => {
    if (p === 'a/b.js') return "import { x } from './c.js';\n";
    if (p === 'a/c.js') return "export * from './d.js';\n";
    throw new Error('no such file: ' + p);
  };
  assert.deepEqual(missingExports(files, readFile, tracked), []);
});

test('skips a target whose source cannot be read', () => {
  const files = ['a/b.js'];
  const tracked = new Set(['a/b.js', 'a/c.js']);
  const readFile = (p) => {
    if (p === 'a/b.js') return "import { x } from './c.js';\n";
    throw new Error('unreadable: ' + p);
  };
  assert.deepEqual(missingExports(files, readFile, tracked), []);
});

test('skips a specifier that resolves to no tracked file', () => {
  const files = ['a/b.js'];
  const tracked = new Set(['a/b.js']);
  const readFile = (p) => {
    if (p === 'a/b.js') return "import { x } from './missing.js';\n";
    throw new Error('no such file: ' + p);
  };
  assert.deepEqual(missingExports(files, readFile, tracked), []);
});

test('skips a file whose source cannot be read', () => {
  const files = ['a/b.js'];
  const tracked = new Set(['a/b.js', 'a/c.js']);
  const readFile = () => { throw new Error('unreadable'); };
  assert.deepEqual(missingExports(files, readFile, tracked), []);
});

test('accepts an array of tracked paths and normalises backslashes', () => {
  const files = ['a\\b.js'];
  const tracked = ['a\\b.js', 'a\\c.js'];
  const readFile = (p) => {
    if (p === 'a\\b.js') return "import { x } from './c.js';\n";
    if (p === 'a\\c.js') return "export const x = 1;\n";
    throw new Error('no such file: ' + p);
  };
  assert.deepEqual(missingExports(files, readFile, tracked), []);
});
