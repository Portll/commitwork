// Maps slice identifiers and stamps to their generated ISO timestamps (monitor/dwell.mjs buildSliceTimeIndex).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSliceTimeIndex } from '../dwell.mjs';

test('returns an empty map when the input is null', () => {
  const r = buildSliceTimeIndex(null);
  assert.deepEqual(r, new Map([]));
});

test('returns an empty map when the input is undefined', () => {
  const r = buildSliceTimeIndex(undefined);
  assert.deepEqual(r, new Map([]));
});

test('returns an empty map when the input is an empty array', () => {
  const r = buildSliceTimeIndex([]);
  assert.deepEqual(r, new Map([]));
});

test('indexes a row with a sliceId and a generated timestamp', () => {
  const r = buildSliceTimeIndex([{ sliceId: 's1', generated: '2024-01-01T00:00:00Z' }]);
  assert.deepEqual(r, new Map([["s1", "2024-01-01T00:00:00Z"]]));
});

test('indexes a row with a stamp and a generated timestamp', () => {
  const r = buildSliceTimeIndex([{ stamp: 42, generated: '2024-01-02T00:00:00Z' }]);
  assert.deepEqual(r, new Map([["42", "2024-01-02T00:00:00Z"]]));
});

test('indexes a row with both sliceId and stamp', () => {
  const r = buildSliceTimeIndex([{ sliceId: 's2', stamp: 99, generated: '2024-01-03T00:00:00Z' }]);
  assert.deepEqual(r, new Map([["s2", "2024-01-03T00:00:00Z"], ["99", "2024-01-03T00:00:00Z"]]));
});

test('skips a row whose generated is missing', () => {
  const r = buildSliceTimeIndex([{ sliceId: 's3', stamp: 7 }]);
  assert.deepEqual(r, new Map([]));
});

test('skips a row whose generated is an empty string', () => {
  const r = buildSliceTimeIndex([{ sliceId: 's4', stamp: 8, generated: '' }]);
  assert.deepEqual(r, new Map([]));
});

test('indexes multiple rows and overwrites duplicate keys', () => {
  const rows = [
    { sliceId: 'a', generated: '2024-01-01T00:00:00Z' },
    { sliceId: 'a', stamp: 1, generated: '2024-01-02T00:00:00Z' },
    { sliceId: 'b', generated: '2024-01-03T00:00:00Z' }
  ];
  const r = buildSliceTimeIndex(rows);
  assert.deepEqual(r, new Map([["a", "2024-01-02T00:00:00Z"], ["1", "2024-01-02T00:00:00Z"], ["b", "2024-01-03T00:00:00Z"]]));
});

test('indexes a row with a numeric stamp as a string key', () => {
  const r = buildSliceTimeIndex([{ stamp: 123, generated: '2024-01-04T00:00:00Z' }]);
  assert.deepEqual(r, new Map([["123", "2024-01-04T00:00:00Z"]]));
});
