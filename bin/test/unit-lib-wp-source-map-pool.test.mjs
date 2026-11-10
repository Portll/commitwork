// Maps a pool of items through an async function with bounded concurrency (bin/lib/wp-source.mjs mapPool).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapPool } from '../lib/wp-source.mjs';

test('returns an empty array when given no items', async () => {
  const r = await mapPool([], 4, async (x, i) => x);
  assert.deepEqual(r, []);
});

test('applies the function to every item when the pool is larger than the item count', async () => {
  const r = await mapPool([1, 2, 3], 10, async (x, i) => x * 10 + i);
  assert.deepEqual(r, [10, 21, 32]);
});

test('preserves the original index for each item when the pool is smaller than the item count', async () => {
  const r = await mapPool([10, 20, 30, 40, 50], 2, async (x, i) => x + i);
  assert.deepEqual(r, [10, 21, 32, 43, 54]);
});

test('passes the item value and its index to the function', async () => {
  const r = await mapPool(['a', 'b', 'c'], 3, async (x, i) => `${x}:${i}`);
  assert.deepEqual(r, ["a:0", "b:1", "c:2"]);
});

test('returns a single-element array when the item count is one and the pool is one', async () => {
  const r = await mapPool([42], 1, async (x, i) => x * 2);
  assert.deepEqual(r, [84]);
});

test('returns a single-element array when the item count is one and the pool is larger', async () => {
  const r = await mapPool([7], 5, async (x, i) => x + 1);
  assert.deepEqual(r, [8]);
});

test('returns a two-element array when the item count is two and the pool is two', async () => {
  const r = await mapPool([1, 2], 2, async (x, i) => x * 100 + i);
  assert.deepEqual(r, [100, 201]);
});

test('returns a two-element array when the item count is two and the pool is one', async () => {
  const r = await mapPool([5, 6], 1, async (x, i) => x - i);
  assert.deepEqual(r, [5, 5]);
});
