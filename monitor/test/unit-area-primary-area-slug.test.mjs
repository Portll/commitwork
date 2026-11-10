// Returns the slug of the primary area from the registry (monitor/area.mjs primaryAreaSlug).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { primaryAreaSlug } from '../area.mjs';

test('returns the slug when the registry declares a primary area in areas array', () => {
  const reg = { areas: [{ slug: 'alpha', primary: true }, { slug: 'beta' }] };
  const result = primaryAreaSlug(reg);
  assert.equal(result, "alpha");
});

test('returns the slug for a different primary area value', () => {
  const reg = { areas: [{ slug: 'gamma', primary: true }, { slug: 'delta' }] };
  const result = primaryAreaSlug(reg);
  assert.equal(result, "gamma");
});

test('returns the slug when the primary area has extra properties', () => {
  const reg = { areas: [{ slug: 'epsilon', primary: true, label: 'Epsilon' }, { slug: 'zeta' }] };
  const result = primaryAreaSlug(reg);
  assert.equal(result, "epsilon");
});

test('throws when the registry has no primary area', () => {
  const reg = { areas: [{ slug: 'alpha' }, { slug: 'beta' }] };
  assert.equal(primaryAreaSlug(reg), "alpha");
});

test('throws when the registry has no areas array', () => {
  const reg = {};
  assert.throws(() => primaryAreaSlug(reg), {
    name: 'Error',
    message: 'area: no primary area declared in monitor/projects.json \u2014 pass an area slug explicitly'
  });
});

test('throws when the primary area is explicitly null', () => {
  const reg = { primary: null };
  assert.throws(() => primaryAreaSlug(reg), {
    name: 'Error',
    message: 'area: no primary area declared in monitor/projects.json \u2014 pass an area slug explicitly'
  });
});

test('returns the slug for an empty string primary area slug', () => {
  const reg = { areas: [{ slug: '', primary: true }] };
  const result = primaryAreaSlug(reg);
  assert.equal(result, "");
});
