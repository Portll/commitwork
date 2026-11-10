// Maps hit offsets to 1-based line numbers (bin/lib/release-scope.mjs locate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locate } from '../lib/release-scope.mjs';

test('returns an empty array when there are no hits', () => {
  const r = locate('abc', []);
  assert.deepEqual(r, []);
});

test('reports the first line for a hit at offset zero', () => {
  const r = locate('abc', [{ start: 0, source: 's', kind: 'k' }]);
  assert.deepEqual(r, [{ line: 1, source: "s", kind: "k" }]);
});

test('reports the first line for a hit before any newline', () => {
  const r = locate('abcdef', [{ start: 2, source: 's', kind: 'k' }]);
  assert.deepEqual(r, [{ line: 1, source: "s", kind: "k" }]);
});

test('reports the second line for a hit after one newline', () => {
  const r = locate('ab\ncd', [{ start: 3, source: 's', kind: 'k' }]);
  assert.deepEqual(r, [{ line: 2, source: "s", kind: "k" }]);
});

test('reports the third line for a hit after two newlines', () => {
  const r = locate('ab\ncd\nef', [{ start: 5, source: 's', kind: 'k' }]);
  assert.deepEqual(r, [{ line: 2, source: "s", kind: "k" }]);
});

test('reports the first line for a hit on the same line as a previous hit', () => {
  const r = locate('ab\ncd', [
    { start: 0, source: 's1', kind: 'k1' },
    { start: 1, source: 's2', kind: 'k2' }
  ]);
  assert.deepEqual(r, [{ line: 1, source: "s1", kind: "k1" }, { line: 1, source: "s2", kind: "k2" }]);
});

test('reports the second line for a hit after a newline following a previous hit', () => {
  const r = locate('ab\ncd', [
    { start: 0, source: 's1', kind: 'k1' },
    { start: 3, source: 's2', kind: 'k2' }
  ]);
  assert.deepEqual(r, [{ line: 1, source: "s1", kind: "k1" }, { line: 2, source: "s2", kind: "k2" }]);
});

test('reports the third line for a hit after two newlines following a previous hit', () => {
  const r = locate('ab\ncd\nef', [
    { start: 0, source: 's1', kind: 'k1' },
    { start: 5, source: 's2', kind: 'k2' }
  ]);
  assert.deepEqual(r, [{ line: 1, source: "s1", kind: "k1" }, { line: 2, source: "s2", kind: "k2" }]);
});
