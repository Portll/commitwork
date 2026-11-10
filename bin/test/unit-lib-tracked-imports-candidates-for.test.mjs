// Resolves import spec to candidate file paths (bin/lib/tracked-imports.mjs candidatesFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidatesFor } from '../lib/tracked-imports.mjs';

test('resolves relative spec from file in nested directory', () => {
  const r = candidatesFor('/src/a/b/file.mjs', './dep');
  assert.deepEqual(r, ["/src/a/b/dep", "/src/a/b/dep.mjs", "/src/a/b/dep.js", "/src/a/b/dep/index.mjs", "/src/a/b/dep/index.js"]);
});

test('resolves relative spec with backslashes in fromFile', () => {
  const r = candidatesFor('C:\\src\\a\\file.mjs', './dep');
  assert.deepEqual(r, ["C:/src/a/dep", "C:/src/a/dep.mjs", "C:/src/a/dep.js", "C:/src/a/dep/index.mjs", "C:/src/a/dep/index.js"]);
});

test('resolves relative spec with backslashes in spec', () => {
  const r = candidatesFor('/src/a/file.mjs', '.\\dep');
  assert.deepEqual(r, ["/src/a/dep", "/src/a/dep.mjs", "/src/a/dep.js", "/src/a/dep/index.mjs", "/src/a/dep/index.js"]);
});

test('resolves spec with parent directory traversal', () => {
  const r = candidatesFor('/src/a/b/file.mjs', '../dep');
  assert.deepEqual(r, ["/src/a/dep", "/src/a/dep.mjs", "/src/a/dep.js", "/src/a/dep/index.mjs", "/src/a/dep/index.js"]);
});

test('resolves spec with multiple parent traversals', () => {
  const r = candidatesFor('/src/a/b/c/file.mjs', '../../dep');
  assert.deepEqual(r, ["/src/a/dep", "/src/a/dep.mjs", "/src/a/dep.js", "/src/a/dep/index.mjs", "/src/a/dep/index.js"]);
});

test('resolves spec with dot segment', () => {
  const r = candidatesFor('/src/a/file.mjs', '././dep');
  assert.deepEqual(r, ["/src/a/dep", "/src/a/dep.mjs", "/src/a/dep.js", "/src/a/dep/index.mjs", "/src/a/dep/index.js"]);
});

test('resolves spec with double slash', () => {
  const r = candidatesFor('/src/a/file.mjs', '//dep');
  assert.deepEqual(r, ["/src/a/dep", "/src/a/dep.mjs", "/src/a/dep.js", "/src/a/dep/index.mjs", "/src/a/dep/index.js"]);
});

test('resolves spec with trailing slash', () => {
  const r = candidatesFor('/src/a/file.mjs', './dep/');
  assert.deepEqual(r, ["/src/a/dep/", "/src/a/dep/.mjs", "/src/a/dep/.js", "/src/a/dep/index.mjs", "/src/a/dep/index.js"]);
});

test('resolves spec with nested path segments', () => {
  const r = candidatesFor('/src/a/file.mjs', './x/y/dep');
  assert.deepEqual(r, ["/src/a/x/y/dep", "/src/a/x/y/dep.mjs", "/src/a/x/y/dep.js", "/src/a/x/y/dep/index.mjs", "/src/a/x/y/dep/index.js"]);
});

test('resolves spec that is just a dot', () => {
  const r = candidatesFor('/src/a/file.mjs', '.');
  assert.deepEqual(r, ["/src/a", "/src/a.mjs", "/src/a.js", "/src/a/index.mjs", "/src/a/index.js"]);
});
