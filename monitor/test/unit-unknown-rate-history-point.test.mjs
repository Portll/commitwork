// Computes a single history point with sanitized numeric fields (monitor/unknown-rate.mjs historyPoint).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyPoint } from '../unknown-rate.mjs';

test('uses default areas and unreadable when options object is omitted', () => {
  const r = historyPoint('2024-01-01T00:00:00Z', { count: 1, observed: 2, population: 3, undetermined: 4 });
  assert.deepEqual(r, { at: "2024-01-01T00:00:00Z", count: 1, observed: 2, population: 3, undetermined: 4, areas: 0, unreadable: 0 });
});

test('uses provided areas and unreadable values from options', () => {
  const r = historyPoint('2024-01-02T00:00:00Z', { count: 5, observed: 6, population: 7, undetermined: 8 }, { areas: 10, unreadable: 20 });
  assert.deepEqual(r, { at: "2024-01-02T00:00:00Z", count: 5, observed: 6, population: 7, undetermined: 8, areas: 10, unreadable: 20 });
});

test('returns null for count when claim is null', () => {
  const r = historyPoint('2024-01-03T00:00:00Z', null);
  assert.deepEqual(r, { at: "2024-01-03T00:00:00Z", count: null, observed: null, population: null, undetermined: null, areas: 0, unreadable: 0 });
});

test('returns null for count when claim is undefined', () => {
  const r = historyPoint('2024-01-04T00:00:00Z', undefined);
  assert.deepEqual(r, { at: "2024-01-04T00:00:00Z", count: null, observed: null, population: null, undetermined: null, areas: 0, unreadable: 0 });
});

test('returns null for count when claim is empty object', () => {
  const r = historyPoint('2024-01-05T00:00:00Z', {});
  assert.deepEqual(r, { at: "2024-01-05T00:00:00Z", count: null, observed: null, population: null, undetermined: null, areas: 0, unreadable: 0 });
});

test('returns null for count when claim.count is NaN', () => {
  const r = historyPoint('2024-01-06T00:00:00Z', { count: NaN, observed: 1, population: 2, undetermined: 3 });
  assert.deepEqual(r, { at: "2024-01-06T00:00:00Z", count: null, observed: 1, population: 2, undetermined: 3, areas: 0, unreadable: 0 });
});

test('returns null for count when claim.count is Infinity', () => {
  const r = historyPoint('2024-01-07T00:00:00Z', { count: Infinity, observed: 1, population: 2, undetermined: 3 });
  assert.deepEqual(r, { at: "2024-01-07T00:00:00Z", count: null, observed: 1, population: 2, undetermined: 3, areas: 0, unreadable: 0 });
});

test('returns null for count when claim.count is a string', () => {
  const r = historyPoint('2024-01-08T00:00:00Z', { count: '5', observed: 1, population: 2, undetermined: 3 });
  assert.deepEqual(r, { at: "2024-01-08T00:00:00Z", count: null, observed: 1, population: 2, undetermined: 3, areas: 0, unreadable: 0 });
});

test('returns null for count when claim.count is a boolean', () => {
  const r = historyPoint('2024-01-09T00:00:00Z', { count: true, observed: 1, population: 2, undetermined: 3 });
  assert.deepEqual(r, { at: "2024-01-09T00:00:00Z", count: null, observed: 1, population: 2, undetermined: 3, areas: 0, unreadable: 0 });
});

test('returns null for count when claim.count is an object', () => {
  const r = historyPoint('2024-01-10T00:00:00Z', { count: {}, observed: 1, population: 2, undetermined: 3 });
  assert.deepEqual(r, { at: "2024-01-10T00:00:00Z", count: null, observed: 1, population: 2, undetermined: 3, areas: 0, unreadable: 0 });
});
