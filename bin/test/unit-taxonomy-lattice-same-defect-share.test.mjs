// Groups same-defect-as edges into pairs that share observation and remedy dimensions (bin/taxonomy-lattice.mjs sameDefectShare).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameDefectShare } from '../taxonomy-lattice.mjs';

test('returns empty arrays when no edges are provided', () => {
  const r = sameDefectShare([], {});
  assert.deepEqual(r, { all: [], sharing: [], apart: [] });
});

test('excludes edges with relation other than same-defect-as', () => {
  const edges = [{ relation: 'related-to', from: 'a', to: 'b' }];
  const objects = { a: ['observation:1'], b: ['observation:1'] };
  const r = sameDefectShare(edges, objects);
  assert.deepEqual(r, { all: [], sharing: [], apart: [] });
});

test('excludes edges where from object is missing', () => {
  const edges = [{ relation: 'same-defect-as', from: 'a', to: 'b' }];
  const objects = { b: ['observation:1'] };
  const r = sameDefectShare(edges, objects);
  assert.deepEqual(r, { all: [], sharing: [], apart: [] });
});

test('excludes edges where to object is missing', () => {
  const edges = [{ relation: 'same-defect-as', from: 'a', to: 'b' }];
  const objects = { a: ['observation:1'] };
  const r = sameDefectShare(edges, objects);
  assert.deepEqual(r, { all: [], sharing: [], apart: [] });
});

test('deduplicates reversed edge pairs', () => {
  const edges = [
    { relation: 'same-defect-as', from: 'a', to: 'b' },
    { relation: 'same-defect-as', from: 'b', to: 'a' }
  ];
  const objects = {
    a: ['observation:1', 'remedy:1'],
    b: ['observation:1', 'remedy:1']
  };
  const r = sameDefectShare(edges, objects);
  assert.deepEqual(r, { all: [["a", "b"]], sharing: [["a", "b"]], apart: [] });
});

test('classifies pair as sharing when both observation and remedy dimensions match', () => {
  const edges = [{ relation: 'same-defect-as', from: 'a', to: 'b' }];
  const objects = {
    a: ['observation:1', 'remedy:1'],
    b: ['observation:1', 'remedy:1']
  };
  const r = sameDefectShare(edges, objects);
  assert.deepEqual(r, { all: [["a", "b"]], sharing: [["a", "b"]], apart: [] });
});

test('classifies pair as apart when only observation dimension matches', () => {
  const edges = [{ relation: 'same-defect-as', from: 'a', to: 'b' }];
  const objects = {
    a: ['observation:1', 'remedy:1'],
    b: ['observation:1', 'remedy:2']
  };
  const r = sameDefectShare(edges, objects);
  assert.deepEqual(r, { all: [["a", "b"]], sharing: [], apart: [["a", "b"]] });
});

test('classifies pair as apart when only remedy dimension matches', () => {
  const edges = [{ relation: 'same-defect-as', from: 'a', to: 'b' }];
  const objects = {
    a: ['observation:1', 'remedy:1'],
    b: ['observation:2', 'remedy:1']
  };
  const r = sameDefectShare(edges, objects);
  assert.deepEqual(r, { all: [["a", "b"]], sharing: [], apart: [["a", "b"]] });
});

test('classifies pair as apart when neither dimension matches', () => {
  const edges = [{ relation: 'same-defect-as', from: 'a', to: 'b' }];
  const objects = {
    a: ['observation:1', 'remedy:1'],
    b: ['observation:2', 'remedy:2']
  };
  const r = sameDefectShare(edges, objects);
  assert.deepEqual(r, { all: [["a", "b"]], sharing: [], apart: [["a", "b"]] });
});

test('handles multiple pairs with mixed sharing and apart classifications', () => {
  const edges = [
    { relation: 'same-defect-as', from: 'a', to: 'b' },
    { relation: 'same-defect-as', from: 'c', to: 'd' },
    { relation: 'same-defect-as', from: 'e', to: 'f' }
  ];
  const objects = {
    a: ['observation:1', 'remedy:1'],
    b: ['observation:1', 'remedy:1'],
    c: ['observation:2', 'remedy:2'],
    d: ['observation:2', 'remedy:3'],
    e: ['observation:3', 'remedy:3'],
    f: ['observation:4', 'remedy:3']
  };
  const r = sameDefectShare(edges, objects);
  assert.deepEqual(r, { all: [["a", "b"], ["c", "d"], ["e", "f"]], sharing: [["a", "b"]], apart: [["c", "d"], ["e", "f"]] });
});
