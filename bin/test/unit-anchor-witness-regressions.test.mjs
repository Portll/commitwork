// Detects store regressions between two snapshots (bin/anchor-witness.mjs regressions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regressions } from '../anchor-witness.mjs';

test('returns empty array when no regressions exist', () => {
  const prev = { stores: [{ name: 'a', present: true, records: 10, generations: 1, tipHash: 'h1' }] };
  const next = { stores: [{ name: 'a', present: true, records: 10, generations: 1, tipHash: 'h1' }] };
  assert.deepEqual(regressions(prev, next), []);
});

test('reports store that was present but is now absent', () => {
  const prev = { stores: [{ name: 'a', present: true, records: 5, generations: 2, tipHash: 'h1' }] };
  const next = { stores: [{ name: 'a', present: false, records: 0, generations: 2, tipHash: 'h1' }] };
  assert.deepEqual(regressions(prev, next), ['a: was present with 5 records, now absent']);
});

test('reports rotated generations that fell', () => {
  const prev = { stores: [{ name: 'a', present: true, records: 10, generations: 5, tipHash: 'h1' }] };
  const next = { stores: [{ name: 'a', present: true, records: 10, generations: 3, tipHash: 'h1' }] };
  assert.deepEqual(regressions(prev, next), ['a: rotated generations fell 5 -> 3']);
});

test('reports records fell with no new generation', () => {
  const prev = { stores: [{ name: 'a', present: true, records: 10, generations: 2, tipHash: 'h1' }] };
  const next = { stores: [{ name: 'a', present: true, records: 8, generations: 2, tipHash: 'h1' }] };
  assert.deepEqual(regressions(prev, next), ['a: records fell 10 -> 8 with no new generation']);
});

test('reports same record count but different tip hash', () => {
  const prev = { stores: [{ name: 'a', present: true, records: 10, generations: 2, tipHash: 'h1' }] };
  const next = { stores: [{ name: 'a', present: true, records: 10, generations: 2, tipHash: 'h2' }] };
  assert.deepEqual(regressions(prev, next), ['a: same record count, different tip \u2014 rewritten in place']);
});

test('reports store no longer reported in next', () => {
  const prev = { stores: [{ name: 'a', present: true, records: 5, generations: 1, tipHash: 'h1' }] };
  const next = { stores: [] };
  assert.deepEqual(regressions(prev, next), ['a: store no longer reported']);
});

test('does not report store that was absent in prev', () => {
  const prev = { stores: [{ name: 'a', present: false, records: 0, generations: 0, tipHash: 'h1' }] };
  const next = { stores: [{ name: 'a', present: true, records: 5, generations: 1, tipHash: 'h1' }] };
  assert.deepEqual(regressions(prev, next), []);
});

test('does not report store with increased records and same generation', () => {
  const prev = { stores: [{ name: 'a', present: true, records: 5, generations: 2, tipHash: 'h1' }] };
  const next = { stores: [{ name: 'a', present: true, records: 10, generations: 2, tipHash: 'h1' }] };
  assert.deepEqual(regressions(prev, next), []);
});

test('does not report store with increased generations', () => {
  const prev = { stores: [{ name: 'a', present: true, records: 5, generations: 2, tipHash: 'h1' }] };
  const next = { stores: [{ name: 'a', present: true, records: 5, generations: 3, tipHash: 'h1' }] };
  assert.deepEqual(regressions(prev, next), []);
});

test('handles multiple stores with mixed regressions', () => {
  const prev = { stores: [
    { name: 'a', present: true, records: 10, generations: 2, tipHash: 'h1' },
    { name: 'b', present: true, records: 5, generations: 1, tipHash: 'h2' },
    { name: 'c', present: false, records: 0, generations: 0, tipHash: 'h3' }
  ]};
  const next = { stores: [
    { name: 'a', present: true, records: 8, generations: 2, tipHash: 'h1' },
    { name: 'b', present: false, records: 0, generations: 1, tipHash: 'h2' },
    { name: 'c', present: true, records: 3, generations: 1, tipHash: 'h3' }
  ]};
  assert.deepEqual(regressions(prev, next), [
    'a: records fell 10 -> 8 with no new generation',
    'b: was present with 5 records, now absent'
  ]);
});
