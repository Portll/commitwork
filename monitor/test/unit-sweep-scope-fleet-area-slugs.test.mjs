// Fleet area slugs excluding paused and excluded areas (monitor/sweep-scope.mjs fleetAreaSlugs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetAreaSlugs } from '../sweep-scope.mjs';

test('returns empty array when reg is null', () => {
  const r = fleetAreaSlugs(null);
  assert.deepEqual(r, []);
});

test('returns empty array when reg has no areas property', () => {
  const r = fleetAreaSlugs({});
  assert.deepEqual(r, []);
});

test('returns empty array when areas is empty', () => {
  const r = fleetAreaSlugs({ areas: [] });
  assert.deepEqual(r, []);
});

test('returns slugs of non-paused areas when none excluded', () => {
  const reg = {
    areas: [
      { slug: 'alpha' },
      { slug: 'beta', paused: { since: '2024-01-01', reason: 'maintenance' } },
      { slug: 'gamma' }
    ]
  };
  const r = fleetAreaSlugs(reg);
  assert.deepEqual(r, ["alpha", "gamma"]);
});

test('filters out excluded areas', () => {
  const reg = {
    areas: [
      { slug: 'alpha' },
      { slug: 'beta' },
      { slug: 'gamma' }
    ]
  };
  const excluded = new Set(['beta']);
  const r = fleetAreaSlugs(reg, excluded);
  assert.deepEqual(r, ["alpha", "gamma"]);
});

test('filters out both excluded and paused areas', () => {
  const reg = {
    areas: [
      { slug: 'alpha' },
      { slug: 'beta', paused: { since: '2024-01-01', reason: 'x' } },
      { slug: 'gamma' },
      { slug: 'delta', paused: { since: '2024-02-01', reason: 'y' } }
    ]
  };
  const excluded = new Set(['alpha', 'delta']);
  const r = fleetAreaSlugs(reg, excluded);
  assert.deepEqual(r, ["gamma"]);
});

test('returns empty when all areas are paused', () => {
  const reg = {
    areas: [
      { slug: 'alpha', paused: { since: '2024-01-01', reason: 'a' } },
      { slug: 'beta', paused: { since: '2024-01-02', reason: 'b' } }
    ]
  };
  const r = fleetAreaSlugs(reg);
  assert.deepEqual(r, []);
});

test('returns empty when all areas are excluded', () => {
  const reg = {
    areas: [
      { slug: 'alpha' },
      { slug: 'beta' }
    ]
  };
  const excluded = new Set(['alpha', 'beta']);
  const r = fleetAreaSlugs(reg, excluded);
  assert.deepEqual(r, []);
});

test('handles area with paused undefined as active', () => {
  const reg = {
    areas: [
      { slug: 'alpha', paused: undefined },
      { slug: 'beta' }
    ]
  };
  const r = fleetAreaSlugs(reg);
  assert.deepEqual(r, ["alpha", "beta"]);
});

test('handles area with paused as null as active', () => {
  const reg = {
    areas: [
      { slug: 'alpha', paused: null },
      { slug: 'beta' }
    ]
  };
  const r = fleetAreaSlugs(reg);
  assert.deepEqual(r, ["alpha", "beta"]);
});
