// Extracts non-empty string names from a rollup repos array (monitor/area-coverage.mjs reposOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reposOf } from '../area-coverage.mjs';

test('returns null when rollup is null', () => {
  assert.equal(reposOf(null), null);
});

test('returns null when rollup is a string', () => {
  assert.equal(reposOf('not-an-object'), null);
});

test('returns null when rollup is a number', () => {
  assert.equal(reposOf(42), null);
});

test('returns null when rollup is a boolean', () => {
  assert.equal(reposOf(true), null);
});

test('returns null when rollup is undefined', () => {
  assert.equal(reposOf(undefined), null);
});

test('returns null when rollup is an object without repos property', () => {
  assert.equal(reposOf({}), null);
});

test('returns null when rollup is an object with repos not an array', () => {
  assert.equal(reposOf({ repos: 'not-an-array' }), null);
});

test('returns null when rollup is an object with repos as a number', () => {
  assert.equal(reposOf({ repos: 123 }), null);
});

test('returns empty array when repos is an empty array', () => {
  assert.deepEqual(reposOf({ repos: [] }), []);
});

test('returns names of valid repos and filters out invalid entries', () => {
  const repos = [
    { name: 'alpha' },
    { name: '' },
    { name: 123 },
    null,
    { name: 'beta' },
    undefined,
    { name: null },
    { name: false },
    { name: 'gamma' }
  ];
  assert.deepEqual(reposOf({ repos }), ["alpha", "beta", "gamma"]);
});
