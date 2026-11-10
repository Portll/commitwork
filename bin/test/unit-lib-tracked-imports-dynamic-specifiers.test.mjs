// Extracts relative dynamic import specifiers from source (bin/lib/tracked-imports.mjs dynamicSpecifiers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dynamicSpecifiers } from '../lib/tracked-imports.mjs';

test('returns a relative specifier for a simple dynamic import', () => {
  const src = "const m = import('./foo.mjs');";
  assert.deepEqual(dynamicSpecifiers(src), ["./foo.mjs"]);
});

test('returns an empty array for a bare package specifier', () => {
  const src = "const m = import('lodash');";
  assert.deepEqual(dynamicSpecifiers(src), []);
});

test('returns an empty array for a specifier containing a template placeholder', () => {
  const src = "const m = import('./${name}.mjs');";
  assert.deepEqual(dynamicSpecifiers(src), []);
});

test('returns an empty array for a specifier containing a template placeholder that is not relative', () => {
  const src = "const m = import('pkg/${name}.mjs');";
  assert.deepEqual(dynamicSpecifiers(src), []);
});

test('returns an empty array for a relative specifier inside a string literal', () => {
  const src = "const s = \"import('./foo.mjs')\";";
  assert.deepEqual(dynamicSpecifiers(src), []);
});

test('returns an empty array for a relative specifier inside a line comment', () => {
  const src = "// import('./foo.mjs');";
  assert.deepEqual(dynamicSpecifiers(src), []);
});

test('returns an empty array for a relative specifier inside a block comment', () => {
  const src = "/* import('./foo.mjs'); */";
  assert.deepEqual(dynamicSpecifiers(src), []);
});

test('strips a query string from the returned specifier', () => {
  const src = "const m = import('./foo.mjs?v=1');";
  assert.deepEqual(dynamicSpecifiers(src), ["./foo.mjs"]);
});

test('returns an empty array for a relative specifier inside a block comment that spans multiple lines', () => {
  const src = "/*\nimport('./foo.mjs');\n*/";
  assert.deepEqual(dynamicSpecifiers(src), []);
});

test('returns an empty array for a relative specifier inside a line comment with a colon before the slash', () => {
  const src = "const url = 'http://example.com'; // import('./foo.mjs');";
  assert.deepEqual(dynamicSpecifiers(src), []);
});
