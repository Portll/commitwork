// Extracts import binding metadata from masked source (codegraph/lexical.mjs importBindings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importBindings } from '../lexical.mjs';

test('parses a default import with a named import in braces', () => {
  const src = 'import def, { a } from "mod";';
  const r = importBindings(src, src);
  assert.deepEqual(r, [{ spec: "mod", local: "def", exported: "default", kind: "default" }, { spec: "mod", local: "a", exported: "a", kind: "named" }]);
});

test('parses a star import with a named import in braces', () => {
  const src = 'import * as ns, { b } from "mod";';
  const r = importBindings(src, src);
  assert.deepEqual(r, [{ spec: "mod", local: "ns", exported: "*", kind: "star" }, { spec: "mod", local: "b", exported: "b", kind: "named" }]);
});

test('parses a named import with a trailing comma in braces', () => {
  const src = 'import { c, } from "mod";';
  const r = importBindings(src, src);
  assert.deepEqual(r, [{ spec: "mod", local: "c", exported: "c", kind: "named" }]);
});

test('parses a named import with an alias in braces', () => {
  const src = 'import { d as e } from "mod";';
  const r = importBindings(src, src);
  assert.deepEqual(r, [{ spec: "mod", local: "e", exported: "d", kind: "named" }]);
});

test('parses a bare import statement', () => {
  const src = 'import "mod";';
  const r = importBindings(src, src);
  assert.deepEqual(r, [{ spec: "mod", local: null, exported: null, kind: "bare" }]);
});

test('returns an empty array for source with no import statements', () => {
  const src = 'const x = 1;';
  const r = importBindings(src, src);
  assert.deepEqual(r, []);
});

test('parses multiple named imports in braces', () => {
  const src = 'import { f, g, h } from "mod";';
  const r = importBindings(src, src);
  assert.deepEqual(r, [{ spec: "mod", local: "f", exported: "f", kind: "named" }, { spec: "mod", local: "g", exported: "g", kind: "named" }, { spec: "mod", local: "h", exported: "h", kind: "named" }]);
});

test('parses a default import with a trailing comma before braces', () => {
  const src = 'import def, { i } from "mod";';
  const r = importBindings(src, src);
  assert.deepEqual(r, [{ spec: "mod", local: "def", exported: "default", kind: "default" }, { spec: "mod", local: "i", exported: "i", kind: "named" }]);
});
