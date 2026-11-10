// Finds bare catch blocks and reports their enclosing named scope and line (bin/bare-catch-ratchet.mjs scanSource).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSource } from '../bare-catch-ratchet.mjs';

test('returns an empty array when the source has no catch block', () => {
  assert.deepEqual(scanSource('const x = 1;'), []);
});

test('reports a module-level catch with the module symbol and its line', () => {
  assert.deepEqual(scanSource('try { } catch { }'), [{ symbol: '<module>', line: 1 }]);
});

test('reports a catch nested inside a named function with the function symbol', () => {
  assert.deepEqual(scanSource('function foo() { try { } catch { } }'), [{ symbol: 'foo', line: 1 }]);
});

test('reports a catch nested inside a class with the class symbol', () => {
  assert.deepEqual(scanSource('class A { m() { try { } catch { } } }'), [{ symbol: "A>m", line: 1 }]);
});

test('reports a catch nested inside a named arrow function with the arrow symbol', () => {
  assert.deepEqual(scanSource('const f = () => { try { } catch { } }'), [{ symbol: 'f', line: 1 }]);
});

test('throws when the source has unbalanced braces after stripping', () => {
  assert.throws(() => scanSource('try { } catch { } {'), /unbalanced after strip/);
});

test('throws when the source has unbalanced parentheses after stripping', () => {
  assert.throws(() => scanSource('try { } catch { } ('), /unbalanced after strip/);
});

test('throws when the source has unbalanced brackets after stripping', () => {
  assert.throws(() => scanSource('try { } catch { } ['), /unbalanced after strip/);
});

test('throws with the provided label when the source is unlexable', () => {
  assert.throws(() => scanSource('try { } catch { } /*', 'mylabel'), /mylabel: unlexable/);
});

test('throws with the default label when the source is unlexable', () => {
  assert.throws(() => scanSource('try { } catch { } /*'), /<source>: unlexable/);
});
