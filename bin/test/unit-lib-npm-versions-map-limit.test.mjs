// Maps items through an async function with bounded concurrency, preserving order (bin/lib/npm-versions.mjs mapLimit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapLimit } from '../lib/npm-versions.mjs';

test('returns an empty array when given no items', async () => {
  const r = await mapLimit([], 3, async (x) => x);
  assert.deepEqual(r, []);
});

test('maps a single item with limit one', async () => {
  const r = await mapLimit([10], 1, async (x) => x * 2);
  assert.deepEqual(r, [20]);
});

test('maps two items with limit one', async () => {
  const r = await mapLimit([1, 2], 1, async (x) => x + 100);
  assert.deepEqual(r, [101, 102]);
});

test('maps three items with limit two', async () => {
  const r = await mapLimit([1, 2, 3], 2, async (x) => x * 10);
  assert.deepEqual(r, [10, 20, 30]);
});

test('maps four items with limit three', async () => {
  const r = await mapLimit([1, 2, 3, 4], 3, async (x) => x + 1);
  assert.deepEqual(r, [2, 3, 4, 5]);
});

test('maps five items with limit five', async () => {
  const r = await mapLimit(Array.from({ length: 5 }, (_, i) => i + 1), 5, async (x) => x * 2);
  assert.deepEqual(r, [2, 4, 6, 8, 10]);
});

test('maps five items with limit ten', async () => {
  const r = await mapLimit(Array.from({ length: 5 }, (_, i) => i + 1), 10, async (x) => x + 10);
  assert.deepEqual(r, [11, 12, 13, 14, 15]);
});

test('passes the index to the mapper', async () => {
  const r = await mapLimit(['a', 'b', 'c'], 2, async (x, i) => `${x}${i}`);
  assert.deepEqual(r, ['a0', 'b1', 'c2']);
});

test('leaves every slot empty when the limit is zero', async () => {
  const r = await mapLimit([1, 2], 0, async (x) => x);
  assert.deepEqual(r, new Array(2));
});

test('rejects with a TypeError when items is null', async () => {
  await assert.rejects(mapLimit(null, 1, async (x) => x), { name: 'TypeError', message: "Cannot read properties of null (reading 'length')" });
});
