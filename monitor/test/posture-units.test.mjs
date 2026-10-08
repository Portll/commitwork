// monitor/test/posture-units.test.mjs — case tests for manifestNamesForArea.
import test from 'node:test';
import assert from 'node:assert/strict';
import { manifestNamesForArea } from '../posture.mjs';

test('returns all manifest names when project is null', () => {
  const reg = { projects: [{ name: 'p1', manifest: 'm1' }, { name: 'p2', manifest: ['m2', 'm3'] }] };
  const result = manifestNamesForArea(null, reg);
  assert.deepEqual([...result].sort(), ['m1', 'm2', 'm3']);
});

test('returns all manifest names when project is empty string', () => {
  const reg = { projects: [{ name: 'p1', manifest: 'm1' }] };
  const result = manifestNamesForArea('', reg);
  assert.deepEqual([...result], ['m1']);
});

test('matches project by name and returns its manifests', () => {
  const reg = { projects: [{ name: 'p1', manifest: 'm1' }, { name: 'p2', manifest: 'm2' }] };
  const result = manifestNamesForArea('p1', reg);
  assert.deepEqual([...result], ['m1']);
});

test('matches project by area slug via areas array', () => {
  const reg = {
    areas: [{ slug: 'area1', name: 'Area One' }],
    projects: [
      { name: 'p1', area: 'area1', manifest: 'm1' },
      { name: 'p2', area: 'area2', manifest: 'm2' }
    ]
  };
  const result = manifestNamesForArea('area1', reg);
  assert.deepEqual([...result], ['m1']);
});

test('falls back to all manifests when no project matches', () => {
  const reg = { projects: [{ name: 'p1', manifest: 'm1' }, { name: 'p2', manifest: 'm2' }] };
  const result = manifestNamesForArea('nonexistent', reg);
  assert.deepEqual([...result].sort(), ['m1', 'm2']);
});

test('handles manifest as single string and array', () => {
  const reg = { projects: [{ name: 'p1', manifest: 'm1' }, { name: 'p2', manifest: ['m2', 'm3'] }] };
  const result = manifestNamesForArea(null, reg);
  assert.deepEqual([...result].sort(), ['m1', 'm2', 'm3']);
});

test('ignores projects without manifest field', () => {
  const reg = { projects: [{ name: 'p1' }, { name: 'p2', manifest: 'm2' }] };
  const result = manifestNamesForArea(null, reg);
  assert.deepEqual([...result], ['m2']);
});

test('matches area by out field', () => {
  const reg = {
    areas: [{ slug: 'area1', out: 'output1' }],
    projects: [
      { name: 'p1', area: 'area1', manifest: 'm1' },
      { name: 'p2', area: 'area2', manifest: 'm2' }
    ]
  };
  const result = manifestNamesForArea('output1', reg);
  assert.deepEqual([...result], ['m1']);
});
