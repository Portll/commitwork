// Maps detector classes to scan coverage status (bin/lib/pattern-core.mjs coverageFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageFor } from '../lib/pattern-core.mjs';

test('returns unscanned when no detectors ran', () => {
  const bindings = { detectors: [{ id: 'd1', classId: 'c1', complete: true, siblingPredicates: [] }] };
  const ran = new Set();
  assert.deepEqual(coverageFor(bindings, ran), { c1: "unscanned" });
});

test('returns complete when all ran and complete', () => {
  const bindings = { detectors: [{ id: 'd1', classId: 'c1', complete: true, siblingPredicates: [] }] };
  const ran = new Set(['d1']);
  assert.deepEqual(coverageFor(bindings, ran), { c1: "complete" });
});

test('returns partial when incomplete but has sibling predicates', () => {
  const bindings = { detectors: [{ id: 'd1', classId: 'c1', complete: false, siblingPredicates: ['p1'] }] };
  const ran = new Set(['d1']);
  assert.deepEqual(coverageFor(bindings, ran), { c1: "partial" });
});

test('returns unspecified when incomplete and no sibling predicates', () => {
  const bindings = { detectors: [{ id: 'd1', classId: 'c1', complete: false, siblingPredicates: [] }] };
  const ran = new Set(['d1']);
  assert.deepEqual(coverageFor(bindings, ran), { c1: "unspecified" });
});

test('handles multiple detectors in same class with mixed completeness', () => {
  const bindings = { detectors: [
    { id: 'd1', classId: 'c1', complete: true, siblingPredicates: [] },
    { id: 'd2', classId: 'c1', complete: false, siblingPredicates: ['p1'] }
  ]};
  const ran = new Set(['d1', 'd2']);
  assert.deepEqual(coverageFor(bindings, ran), { c1: "partial" });
});

test('handles multiple classes independently', () => {
  const bindings = { detectors: [
    { id: 'd1', classId: 'c1', complete: true, siblingPredicates: [] },
    { id: 'd2', classId: 'c2', complete: false, siblingPredicates: [] }
  ]};
  const ran = new Set(['d1']);
  assert.deepEqual(coverageFor(bindings, ran), { c1: "complete", c2: "unscanned" });
});

test('handles undefined siblingPredicates as empty', () => {
  const bindings = { detectors: [{ id: 'd1', classId: 'c1', complete: false, siblingPredicates: undefined }] };
  const ran = new Set(['d1']);
  assert.deepEqual(coverageFor(bindings, ran), { c1: "unspecified" });
});

test('handles null siblingPredicates as empty', () => {
  const bindings = { detectors: [{ id: 'd1', classId: 'c1', complete: false, siblingPredicates: null }] };
  const ran = new Set(['d1']);
  assert.deepEqual(coverageFor(bindings, ran), { c1: "unspecified" });
});
