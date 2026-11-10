// returns a fresh empty launch list state object (lib/launchlist.mjs emptyState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../launchlist.mjs';

test('emptyState returns a new object each call', () => {
  const r1 = emptyState();
  const r2 = emptyState();
  assert.deepEqual(r1, { version: 1, ticks: {}, items: {}, log: [] });
  assert.deepEqual(r2, { version: 1, ticks: {}, items: {}, log: [] });
});

test('emptyState object has version 1', () => {
  const r = emptyState();
  assert.deepEqual(r, { version: 1, ticks: {}, items: {}, log: [] });
});

test('emptyState object has empty ticks map', () => {
  const r = emptyState();
  assert.deepEqual(r, { version: 1, ticks: {}, items: {}, log: [] });
});

test('emptyState object has empty items map', () => {
  const r = emptyState();
  assert.deepEqual(r, { version: 1, ticks: {}, items: {}, log: [] });
});

test('emptyState object has empty log array', () => {
  const r = emptyState();
  assert.deepEqual(r, { version: 1, ticks: {}, items: {}, log: [] });
});
