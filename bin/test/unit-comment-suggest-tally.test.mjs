// Counts occurrences of each fate value at indices 0 and 1 (bin/comment-suggest.mjs tally).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally } from '../comment-suggest.mjs';

test('empty fate returns empty objects for f1 and f2', () => {
  assert.deepEqual(tally([]), { f1: {}, f2: {} });
});

test('single fate with truthy values counts each once', () => {
  assert.deepEqual(tally([['a', 'b']]), { f1: { a: 1 }, f2: { b: 1 } });
});

test('falsy values at index 0 and 1 are skipped', () => {
  assert.deepEqual(tally([[0, ''], [null, undefined]]), { f1: {}, f2: {} });
});

test('repeated same value at index 0 accumulates count', () => {
  assert.deepEqual(tally([['x', 'y'], ['x', 'z'], ['x', 'w']]), { f1: { x: 3 }, f2: { y: 1, z: 1, w: 1 } });
});

test('repeated same value at index 1 accumulates count', () => {
  assert.deepEqual(tally([['a', 'q'], ['b', 'q'], ['c', 'q']]), { f1: { a: 1, b: 1, c: 1 }, f2: { q: 3 } });
});

test('mixed truthy and falsy values count only truthy', () => {
  assert.deepEqual(tally([['a', 'b'], [0, 'c'], [null, '']]), { f1: { a: 1 }, f2: { b: 1, c: 1 } });
});

test('different values at both indices are counted separately', () => {
  assert.deepEqual(tally([['m', 'n'], ['o', 'p']]), { f1: { m: 1, o: 1 }, f2: { n: 1, p: 1 } });
});

test('falsy value at index 0 with truthy at index 1 counts only index 1', () => {
  assert.deepEqual(tally([[false, 'v']]), { f1: {}, f2: { v: 1 } });
});
