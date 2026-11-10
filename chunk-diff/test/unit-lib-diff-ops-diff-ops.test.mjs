// Computes the longest common subsequence diff operations between two arrays (chunk-diff/lib/diff-ops.mjs diffOps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffOps } from '../lib/diff-ops.mjs';

test('returns empty array when both inputs are empty', () => {
  const r = diffOps([], []);
  assert.deepEqual(r, []);
});

test('returns all plus ops when first input is empty', () => {
  const r = diffOps([], ['a', 'b']);
  assert.deepEqual(r, [{ t: "+", s: "a" }, { t: "+", s: "b" }]);
});

test('returns all minus ops when second input is empty', () => {
  const r = diffOps(['a', 'b'], []);
  assert.deepEqual(r, [{ t: "-", s: "a" }, { t: "-", s: "b" }]);
});

test('returns equal ops when inputs are identical', () => {
  const r = diffOps(['x', 'y', 'z'], ['x', 'y', 'z']);
  assert.deepEqual(r, [{ t: "=", s: "x" }, { t: "=", s: "y" }, { t: "=", s: "z" }]);
});

test('returns minus then plus when first element differs', () => {
  const r = diffOps(['a', 'b'], ['c', 'b']);
  assert.deepEqual(r, [{ t: "-", s: "a" }, { t: "+", s: "c" }, { t: "=", s: "b" }]);
});

test('returns plus then minus when second element differs', () => {
  const r = diffOps(['a', 'b'], ['a', 'c']);
  assert.deepEqual(r, [{ t: "=", s: "a" }, { t: "-", s: "b" }, { t: "+", s: "c" }]);
});

test('handles mixed matches and mismatches in longer arrays', () => {
  const r = diffOps(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'y', 'd']);
  assert.deepEqual(r, [{ t: "=", s: "a" }, { t: "-", s: "b" }, { t: "+", s: "x" }, { t: "=", s: "c" }, { t: "+", s: "y" }, { t: "=", s: "d" }]);
});

test('handles single element inputs with mismatch', () => {
  const r = diffOps(['a'], ['b']);
  assert.deepEqual(r, [{ t: "-", s: "a" }, { t: "+", s: "b" }]);
});

test('handles single element inputs with match', () => {
  const r = diffOps(['a'], ['a']);
  assert.deepEqual(r, [{ t: "=", s: "a" }]);
});

test('handles repeated elements with different lengths', () => {
  const r = diffOps(['a', 'a', 'b'], ['a', 'b', 'b']);
  assert.deepEqual(r, [{ t: "=", s: "a" }, { t: "-", s: "a" }, { t: "=", s: "b" }, { t: "+", s: "b" }]);
});
