// Extracts module symbols, calls, and exports from source text (codegraph/lexical.mjs extract).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract } from '../lexical.mjs';

test('returns ok false with reason when lexer bails', () => {
  const src = 'const x = "unterminated';
  const r = extract(src);
  assert.deepEqual(r, { ok: false, reason: "lexer bailed: unterminated double-quoted string at offset 10", masked: null, symbols: [], calls: [], exportedNames: [], reexports: [] });
});

test('returns ok false with reason when brace scan fails', () => {
  const src = 'function f() { return 1;';
  const r = extract(src);
  assert.deepEqual(r, { ok: false, reason: "brace scan failed: 1 unclosed {", masked: null, symbols: [], calls: [], exportedNames: [], reexports: [] });
});

test('skips functions nested inside other functions', () => {
  const src = 'function outer() { function inner() { return 1; } return inner(); }';
  const r = extract(src);
  assert.deepEqual(r, { ok: true, reason: null, masked: "function outer() { function inner() { return 1; } return inner(); }", symbols: [{ name: "outer", kind: "function", line: 1, start: 0, body: [17, 66], exported: false, depth: 0 }], calls: [{ name: "inner", line: 1, at: 28, from: "outer" }, { name: "inner", line: 1, at: 57, from: "outer" }], exportedNames: [], reexports: [], defaultObjectLiteral: false });
});

test('records function declaration with correct header span', () => {
  const src = 'function foo(a, b) { return a + b; }';
  const r = extract(src);
  assert.deepEqual(r, { ok: true, reason: null, masked: "function foo(a, b) { return a + b; }", symbols: [{ name: "foo", kind: "function", line: 1, start: 0, body: [19, 35], exported: false, depth: 0 }], calls: [], exportedNames: [], reexports: [], defaultObjectLiteral: false });
});

test('skips class declarations nested inside other blocks', () => {
  const src = 'if (true) { class Inner { method() { return 1; } } }';
  const r = extract(src);
  assert.deepEqual(r, { ok: true, reason: null, masked: "if (true) { class Inner { method() { return 1; } } }", symbols: [], calls: [{ name: "method", line: 1, at: 26, from: null }], exportedNames: [], reexports: [], defaultObjectLiteral: false });
});

test('adds default to exported names for export default function', () => {
  const src = 'export default function () { return 1; }';
  const r = extract(src);
  assert.deepEqual(r, { ok: true, reason: null, masked: "export default function () { return 1; }", symbols: [], calls: [], exportedNames: ["default"], reexports: [], defaultObjectLiteral: false });
});

test('computes correct eq offset for binding declarations', () => {
  const src = 'const x = 1;';
  const r = extract(src);
  assert.deepEqual(r, { ok: true, reason: null, masked: "const x = 1;", symbols: [{ name: "x", kind: "const", line: 1, start: 0, body: null, exported: false, depth: 0 }], calls: [], exportedNames: [], reexports: [], defaultObjectLiteral: false });
});

test('classifies arrow function bindings as function kind', () => {
  const src = 'const fn = () => 42;';
  const r = extract(src);
  assert.deepEqual(r, { ok: true, reason: null, masked: "const fn = () => 42;", symbols: [{ name: "fn", kind: "function", line: 1, start: 0, body: [10, 19], exported: false, depth: 0 }], calls: [], exportedNames: [], reexports: [], defaultObjectLiteral: false });
});

test('adds exported names from export list with as clause', () => {
  const src = 'const a = 1; const b = 2; export { a as c, b };';
  const r = extract(src);
  assert.deepEqual(r, { ok: true, reason: null, masked: "const a = 1; const b = 2; export { a as c, b };", symbols: [{ name: "a", kind: "const", line: 1, start: 0, body: null, exported: false, depth: 0 }, { name: "b", kind: "const", line: 1, start: 13, body: null, exported: false, depth: 0 }], calls: [], exportedNames: ["b", "c"], reexports: [], defaultObjectLiteral: false });
});

test('skips calls whose name is preceded by dot or question mark', () => {
  const src = 'const o = { m() { return 1; } }; o.m();';
  const r = extract(src);
  assert.deepEqual(r, { ok: true, reason: null, masked: "const o = { m() { return 1; } }; o.m();", symbols: [{ name: "o", kind: "const", line: 1, start: 0, body: [10, 30], exported: false, depth: 0 }], calls: [{ name: "m", line: 1, at: 12, from: "o" }], exportedNames: [], reexports: [], defaultObjectLiteral: false });
});
