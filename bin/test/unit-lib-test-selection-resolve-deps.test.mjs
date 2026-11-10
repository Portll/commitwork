// Resolves relative dependency specs to existing file paths (bin/lib/test-selection.mjs resolveDeps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDeps } from '../lib/test-selection.mjs';
import { join, dirname } from 'node:path';

test('returns empty array when specs is empty', () => {
  const r = resolveDeps('/a/b/c.mjs', [], () => true);
  assert.deepEqual(r, []);
});

test('returns empty array when no spec resolves to an existing file', () => {
  const r = resolveDeps('/a/b/c.mjs', ['missing'], () => false);
  assert.deepEqual(r, []);
});

test('resolves spec to exact base path when exists returns true for base', () => {
  const fromFile = '/a/b/c.mjs';
  const specs = ['dep'];
  const exists = (p) => p === join(dirname(fromFile), 'dep');
  const r = resolveDeps(fromFile, specs, exists);
  assert.deepEqual(r, ["/a/b/dep"]);
});

test('resolves spec to base with .mjs extension when base does not exist', () => {
  const fromFile = '/a/b/c.mjs';
  const specs = ['dep'];
  const base = join(dirname(fromFile), 'dep');
  const exists = (p) => p === `${base}.mjs`;
  const r = resolveDeps(fromFile, specs, exists);
  assert.deepEqual(r, ["/a/b/dep.mjs"]);
});

test('resolves spec to base with .js extension when base and .mjs do not exist', () => {
  const fromFile = '/a/b/c.mjs';
  const specs = ['dep'];
  const base = join(dirname(fromFile), 'dep');
  const exists = (p) => p === `${base}.js`;
  const r = resolveDeps(fromFile, specs, exists);
  assert.deepEqual(r, ["/a/b/dep.js"]);
});

test('resolves spec to index.mjs inside base directory when file extensions do not exist', () => {
  const fromFile = '/a/b/c.mjs';
  const specs = ['dep'];
  const base = join(dirname(fromFile), 'dep');
  const exists = (p) => p === join(base, 'index.mjs');
  const r = resolveDeps(fromFile, specs, exists);
  assert.deepEqual(r, ["/a/b/dep/index.mjs"]);
});

test('resolves spec to index.js inside base directory when index.mjs does not exist', () => {
  const fromFile = '/a/b/c.mjs';
  const specs = ['dep'];
  const base = join(dirname(fromFile), 'dep');
  const exists = (p) => p === join(base, 'index.js');
  const r = resolveDeps(fromFile, specs, exists);
  assert.deepEqual(r, ["/a/b/dep/index.js"]);
});

test('resolves multiple specs independently and returns all hits in order', () => {
  const fromFile = '/a/b/c.mjs';
  const specs = ['x', 'y', 'z'];
  const exists = (p) => p.endsWith('.mjs') && !p.endsWith('index.mjs');
  const r = resolveDeps(fromFile, specs, exists);
  assert.deepEqual(r, ["/a/b/x.mjs", "/a/b/y.mjs", "/a/b/z.mjs"]);
});

test('skips specs that do not resolve while keeping those that do', () => {
  const fromFile = '/a/b/c.mjs';
  const specs = ['good', 'bad', 'also-good'];
  const exists = (p) => p.includes('good') && p.endsWith('.js');
  const r = resolveDeps(fromFile, specs, exists);
  assert.deepEqual(r, ["/a/b/good.js", "/a/b/also-good.js"]);
});

test('prefers base over extensions when exists returns true for multiple candidates', () => {
  const fromFile = '/a/b/c.mjs';
  const specs = ['dep'];
  const base = join(dirname(fromFile), 'dep');
  const exists = (p) => p === base || p === `${base}.mjs`;
  const r = resolveDeps(fromFile, specs, exists);
  assert.deepEqual(r, ["/a/b/dep"]);
});
