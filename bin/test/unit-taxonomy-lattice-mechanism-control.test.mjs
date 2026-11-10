// Computes mechanism-of specialisation control results (bin/taxonomy-lattice.mjs mechanismControl).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mechanismControl } from '../taxonomy-lattice.mjs';

test('specialises when source is longer and contains target', () => {
  const edges = [{ from: 'a', to: 'b', relation: 'mechanism-of' }];
  const objects = { a: ['x', 'y'], b: ['x'] };
  const r = mechanismControl(edges, objects);
  assert.deepEqual(r, { all: [{ from: "a", to: "b", relation: "mechanism-of" }], specialised: [{ from: "a", to: "b", relation: "mechanism-of" }], missed: [], contested: [] });
});

test('misses with identical outcome when lengths equal and source contains target', () => {
  const edges = [{ from: 'a', to: 'b', relation: 'mechanism-of' }];
  const objects = { a: ['x', 'y'], b: ['x', 'y'] };
  const r = mechanismControl(edges, objects);
  assert.deepEqual(r, { all: [{ from: "a", to: "b", relation: "mechanism-of" }], specialised: [], missed: [{ from: "a", to: "b", relation: "mechanism-of", outcome: "identical" }], contested: [] });
});

test('misses with inverted outcome when target is longer and contains source', () => {
  const edges = [{ from: 'a', to: 'b', relation: 'mechanism-of' }];
  const objects = { a: ['x'], b: ['x', 'y'] };
  const r = mechanismControl(edges, objects);
  assert.deepEqual(r, { all: [{ from: "a", to: "b", relation: "mechanism-of" }], specialised: [], missed: [{ from: "a", to: "b", relation: "mechanism-of", outcome: "inverted" }], contested: [] });
});

test('misses with unrelated outcome when neither contains the other', () => {
  const edges = [{ from: 'a', to: 'b', relation: 'mechanism-of' }];
  const objects = { a: ['x'], b: ['y'] };
  const r = mechanismControl(edges, objects);
  assert.deepEqual(r, { all: [{ from: "a", to: "b", relation: "mechanism-of" }], specialised: [], missed: [{ from: "a", to: "b", relation: "mechanism-of", outcome: "unrelated, target needs y" }], contested: [] });
});

test('excludes non-mechanism-of edges from the slice', () => {
  const edges = [
    { from: 'a', to: 'b', relation: 'part-of' },
    { from: 'c', to: 'd', relation: 'mechanism-of' }
  ];
  const objects = { a: ['x'], b: ['x'], c: ['x', 'y'], d: ['x'] };
  const r = mechanismControl(edges, objects);
  assert.deepEqual(r, { all: [{ from: "c", to: "d", relation: "mechanism-of" }], specialised: [{ from: "c", to: "d", relation: "mechanism-of" }], missed: [], contested: [] });
});

test('excludes edges whose endpoints are missing from objects', () => {
  const edges = [
    { from: 'a', to: 'b', relation: 'mechanism-of' },
    { from: 'c', to: 'd', relation: 'mechanism-of' }
  ];
  const objects = { a: ['x'], b: ['x'] };
  const r = mechanismControl(edges, objects);
  assert.deepEqual(r, { all: [{ from: "a", to: "b", relation: "mechanism-of" }], specialised: [], missed: [{ from: "a", to: "b", relation: "mechanism-of", outcome: "identical" }], contested: [] });
});

test('reports contested edges separately with basis and excludes them from gating', () => {
  const edges = [
    { from: 'a', to: 'b', relation: 'mechanism-of' },
    { from: 'c', to: 'd', relation: 'mechanism-of' }
  ];
  const objects = { a: ['x', 'y'], b: ['x'], c: ['x', 'y'], d: ['x'] };
  const contested = [{ from: 'c', to: 'd', relation: 'mechanism-of', basis: 'rater-rejected' }];
  const r = mechanismControl(edges, objects, contested);
  assert.deepEqual(r, { all: [{ from: "a", to: "b", relation: "mechanism-of" }], specialised: [{ from: "a", to: "b", relation: "mechanism-of" }], missed: [], contested: [{ from: "c", to: "d", relation: "mechanism-of", basis: "rater-rejected" }] });
});

test('returns empty arrays when no edges match the slice', () => {
  const edges = [{ from: 'a', to: 'b', relation: 'part-of' }];
  const objects = { a: ['x'], b: ['x'] };
  const r = mechanismControl(edges, objects);
  assert.deepEqual(r, { all: [], specialised: [], missed: [], contested: [] });
});
