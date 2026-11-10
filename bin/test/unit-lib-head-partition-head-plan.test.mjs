// Computes the partition plan (skip, full, or targeted) for failing test names (bin/lib/head-partition.mjs headPlan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headPlan } from '../lib/head-partition.mjs';

test('returns skip mode when no names failed', () => {
  assert.deepEqual(headPlan([], [], () => ''), { mode: "skip", files: [], why: "nothing failed in the working tree, so there is nothing to attribute" });
});

test('returns full mode when a name is unresolved', () => {
  const readFile = (f) => f === 'a.test.js' ? 'test("alpha")' : '';
  assert.deepEqual(headPlan(['alpha', 'missing'], ['a.test.js'], readFile), { mode: "full", files: [], unresolved: ["missing"], why: "1 of 2 failing test name(s) could not be located in any test file, so the partition would be computed from an incomplete mapping" });
});

test('returns full mode when names resolve to no files', () => {
  const readFile = () => '';
  assert.deepEqual(headPlan(['alpha'], ['a.test.js'], readFile), { mode: "full", files: [], unresolved: ["alpha"], why: "1 of 1 failing test name(s) could not be located in any test file, so the partition would be computed from an incomplete mapping" });
});

test('returns targeted mode when names resolve to files', () => {
  const readFile = (f) => f === 'a.test.js' ? 'test("alpha")' : '';
  assert.deepEqual(headPlan(['alpha'], ['a.test.js'], readFile), { mode: "targeted", files: ["a.test.js"], ambiguous: [], why: "1 file(s) carry the 1 failing test name(s)" });
});

test('returns targeted mode with ambiguous entries when multiple files match', () => {
  const readFile = (f) => f === 'a.test.js' || f === 'b.test.js' ? 'test("alpha")' : '';
  assert.deepEqual(headPlan(['alpha'], ['a.test.js', 'b.test.js'], readFile), { mode: "targeted", files: ["a.test.js", "b.test.js"], ambiguous: [{ name: "alpha", files: ["a.test.js", "b.test.js"] }], why: "2 file(s) carry the 1 failing test name(s)" });
});

test('returns full mode when exactly one name is unresolved', () => {
  const readFile = (f) => f === 'a.test.js' ? 'test("alpha")' : '';
  assert.deepEqual(headPlan(['alpha', 'missing'], ['a.test.js'], readFile), { mode: "full", files: [], unresolved: ["missing"], why: "1 of 2 failing test name(s) could not be located in any test file, so the partition would be computed from an incomplete mapping" });
});

test('returns targeted mode when exactly one file matches', () => {
  const readFile = (f) => f === 'a.test.js' ? 'test("alpha")' : '';
  assert.deepEqual(headPlan(['alpha'], ['a.test.js'], readFile), { mode: "targeted", files: ["a.test.js"], ambiguous: [], why: "1 file(s) carry the 1 failing test name(s)" });
});

test('returns skip mode when exactly one name is provided but empty after dedup', () => {
  assert.deepEqual(headPlan([null], [], () => ''), { mode: "full", files: [], why: "names resolved to no files" });
});
