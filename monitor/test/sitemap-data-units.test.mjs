// monitor/test/sitemap-data-units.test.mjs — case tests for buildEntry, lifecycleOf.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEntry, lifecycleOf } from '../sitemap-data.mjs';

test('returns null when entry path is missing and no riders or discovered', () => {
  const entry = { path: '/nonexistent/path/xyz', name: 'xyz' };
  const result = buildEntry(entry, [], 'slug', [], {});
  assert.equal(result, null);
});


test('returns null when entry is null and no riders or discovered', () => {
  const result = buildEntry(null, [], 'slug', [], {});
  assert.equal(result, null);
});

test('returns null when entry is null, no riders, and discovered path is missing', () => {
  const discovered = [{ name: 'repo1', path: '/nonexistent/repo1' }];
  const result = buildEntry(null, [], 'slug', discovered, {});
  assert.equal(result, null);
});


test('returns null when entry path missing but riders exist yet all rider paths missing', () => {
  const entry = { path: '/nonexistent/entry', name: 'entry' };
  const riders = [{ path: '/nonexistent/rider1' }];
  const result = buildEntry(entry, riders, 'slug', [], {});
  assert.equal(result, null);
});

test('returns retired when name is in exclude', () => {
  const reg = { exclude: ['old-svc'] };
  assert.deepEqual(lifecycleOf('old-svc', reg), { lifecycle: 'retired' });
});

test('returns active when no lifecycle entry exists', () => {
  const reg = { lifecycle: {} };
  assert.deepEqual(lifecycleOf('new-svc', reg), { lifecycle: 'active' });
});

test('returns active when lifecycle state is not superseded', () => {
  const reg = { lifecycle: { svc: { state: 'active' } } };
  assert.deepEqual(lifecycleOf('svc', reg), { lifecycle: 'active' });
});

test('returns superseded with supersededBy when state is superseded and no effective dates', () => {
  const reg = { lifecycle: { svc: { state: 'superseded', supersededBy: 'new-svc' } } };
  assert.deepEqual(lifecycleOf('svc', reg), { lifecycle: 'superseded', supersededBy: 'new-svc' });
});

test('returns superseded with null supersededBy when state is superseded and no supersededBy field', () => {
  const reg = { lifecycle: { svc: { state: 'superseded' } } };
  assert.deepEqual(lifecycleOf('svc', reg), { lifecycle: 'superseded', supersededBy: null });
});

test('returns active when effectiveFrom is in the future', () => {
  const reg = { lifecycle: { svc: { state: 'superseded', effectiveFrom: '99991231235959' } } };
  assert.deepEqual(lifecycleOf('svc', reg), { lifecycle: 'active' });
});

test('returns active when effectiveTo is in the past', () => {
  const reg = { lifecycle: { svc: { state: 'superseded', effectiveTo: '00000101000000' } } };
  assert.deepEqual(lifecycleOf('svc', reg), { lifecycle: 'active' });
});

test('returns active when reg is empty object', () => {
  assert.deepEqual(lifecycleOf('anything', {}), { lifecycle: 'active' });
});
