// Computes the lifecycle state (retired, superseded, or active) of a named area (monitor/sitemap-data.mjs lifecycleOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lifecycleOf } from '../sitemap-data.mjs';

test('returns retired when name is in the exclude list', () => {
  const reg = { exclude: ['old-area', 'legacy'] };
  assert.deepEqual(lifecycleOf('old-area', reg), { lifecycle: 'retired' });
});

test('returns retired even if lifecycle entry exists for excluded name', () => {
  const reg = {
    exclude: ['x'],
    lifecycle: { x: { state: 'active' } }
  };
  assert.deepEqual(lifecycleOf('x', reg), { lifecycle: 'retired' });
});

test('returns active when no lifecycle entry exists for name', () => {
  const reg = { lifecycle: { other: { state: 'active' } } };
  assert.deepEqual(lifecycleOf('missing', reg), { lifecycle: 'active' });
});

test('returns active when lifecycle state is not superseded', () => {
  const reg = { lifecycle: { a: { state: 'active' } } };
  assert.deepEqual(lifecycleOf('a', reg), { lifecycle: 'active' });
});

test('returns superseded with supersededBy when state is superseded and no effective dates', () => {
  const reg = { lifecycle: { b: { state: 'superseded', supersededBy: 'c' } } };
  assert.deepEqual(lifecycleOf('b', reg), { lifecycle: 'superseded', supersededBy: 'c' });
});

test('returns superseded with null supersededBy when state is superseded and no supersededBy field', () => {
  const reg = { lifecycle: { d: { state: 'superseded' } } };
  assert.deepEqual(lifecycleOf('d', reg), { lifecycle: 'superseded', supersededBy: null });
});

test('returns active when superseded but effectiveFrom is in the future', () => {
  const reg = { lifecycle: { e: { state: 'superseded', effectiveFrom: '99999999999999' } } };
  assert.deepEqual(lifecycleOf('e', reg), { lifecycle: 'active' });
});

test('returns active when superseded but effectiveTo is in the past', () => {
  const reg = { lifecycle: { f: { state: 'superseded', effectiveTo: '00000000000000' } } };
  assert.deepEqual(lifecycleOf('f', reg), { lifecycle: 'active' });
});

test('returns superseded when effectiveFrom is in the past and effectiveTo is in the future', () => {
  const reg = { lifecycle: { g: { state: 'superseded', effectiveFrom: '00000000000000', effectiveTo: '99999999999999', supersededBy: 'h' } } };
  assert.deepEqual(lifecycleOf('g', reg), { lifecycle: 'superseded', supersededBy: 'h' });
});

test('returns active when lifecycle is undefined and exclude is undefined', () => {
  const reg = {};
  assert.deepEqual(lifecycleOf('anything', reg), { lifecycle: 'active' });
});
