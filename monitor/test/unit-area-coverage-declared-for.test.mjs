// Filters registry projects by area and returns their names (monitor/area-coverage.mjs declaredFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declaredFor } from '../area-coverage.mjs';

test('returns names of projects matching the area from an array registry', () => {
  const registry = [
    { name: 'alpha', area: 'web' },
    { name: 'beta', area: 'api' },
    { name: 'gamma', area: 'web' }
  ];
  const r = declaredFor(registry, 'web');
  assert.deepEqual(r, ["alpha", "gamma"]);
});

test('returns names of projects matching the area from an object registry with projects key', () => {
  const registry = {
    projects: [
      { name: 'svc1', area: 'data' },
      { name: 'svc2', area: 'data' },
      { name: 'svc3', area: 'other' }
    ]
  };
  const r = declaredFor(registry, 'data');
  assert.deepEqual(r, ["svc1", "svc2"]);
});

test('returns empty array when no projects match the area', () => {
  const registry = [
    { name: 'x', area: 'a' },
    { name: 'y', area: 'b' }
  ];
  const r = declaredFor(registry, 'c');
  assert.deepEqual(r, []);
});

test('returns empty array when registry is null', () => {
  const r = declaredFor(null, 'web');
  assert.deepEqual(r, []);
});

test('returns empty array when registry is undefined', () => {
  const r = declaredFor(undefined, 'web');
  assert.deepEqual(r, []);
});

test('returns empty array when registry object has no projects property', () => {
  const registry = { other: [] };
  const r = declaredFor(registry, 'web');
  assert.deepEqual(r, []);
});

test('excludes null entries and entries without a name from results', () => {
  const registry = [
    null,
    { name: 'valid', area: 'web' },
    { area: 'web' },
    { name: '', area: 'web' },
    { name: 'also-valid', area: 'web' }
  ];
  const r = declaredFor(registry, 'web');
  assert.deepEqual(r, ["valid", "also-valid"]);
});

test('returns empty array when registry is an empty array', () => {
  const r = declaredFor([], 'web');
  assert.deepEqual(r, []);
});
