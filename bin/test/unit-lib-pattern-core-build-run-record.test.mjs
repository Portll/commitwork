// Computes a pattern-scan run record with coverage and counts (bin/lib/pattern-core.mjs buildRunRecord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunRecord } from '../lib/pattern-core.mjs';

test('counts findings, undetermined, accepted, and baseline from results', () => {
  const results = [
    { adjudication: 'finding' },
    { adjudication: 'finding' },
    { adjudication: 'undetermined' },
    { adjudication: 'accepted' },
    { adjudication: 'baseline' },
  ];
  const r = buildRunRecord({
    at: '2024-01-01T00:00:00Z',
    tree: 'abc123',
    taxonomy: 't1',
    bindingsHash: 'hash1',
    detectors: ['d1'],
    coverage: { a: 'complete', b: 'partial', c: 'unspecified', d: 'unscanned' },
    results,
    classesTotal: 4,
  });
  assert.deepEqual(r.counts, { finding: 2, undetermined: 1, accepted: 1, baseline: 1 });
});

test('schema is commitwork.pattern-scan/1', () => {
  const r = buildRunRecord({
    at: '2024-01-01T00:00:00Z',
    tree: 'abc123',
    taxonomy: 't1',
    bindingsHash: 'hash1',
    detectors: ['d1'],
    coverage: { a: 'complete' },
    results: [],
    classesTotal: 1,
  });
  assert.equal(r.schema, "commitwork.pattern-scan/1");
});

test('coverage complete count matches states marked complete', () => {
  const r = buildRunRecord({
    at: '2024-01-01T00:00:00Z',
    tree: 'abc123',
    taxonomy: 't1',
    bindingsHash: 'hash1',
    detectors: ['d1'],
    coverage: { a: 'complete', b: 'complete', c: 'partial', d: 'unscanned' },
    results: [],
    classesTotal: 4,
  });
  assert.equal(r.reach.coverage.complete, 2);
});

test('coverage partial count matches states marked partial', () => {
  const r = buildRunRecord({
    at: '2024-01-01T00:00:00Z',
    tree: 'abc123',
    taxonomy: 't1',
    bindingsHash: 'hash1',
    detectors: ['d1'],
    coverage: { a: 'partial', b: 'partial', c: 'complete', d: 'unscanned' },
    results: [],
    classesTotal: 4,
  });
  assert.equal(r.reach.coverage.partial, 2);
});

test('coverage unspecified count matches states marked unspecified', () => {
  const r = buildRunRecord({
    at: '2024-01-01T00:00:00Z',
    tree: 'abc123',
    taxonomy: 't1',
    bindingsHash: 'hash1',
    detectors: ['d1'],
    coverage: { a: 'unspecified', b: 'unspecified', c: 'complete', d: 'unscanned' },
    results: [],
    classesTotal: 4,
  });
  assert.equal(r.reach.coverage.unspecified, 2);
});

test('coverage unscanned count is classesTotal minus non-unscanned states', () => {
  const r = buildRunRecord({
    at: '2024-01-01T00:00:00Z',
    tree: 'abc123',
    taxonomy: 't1',
    bindingsHash: 'hash1',
    detectors: ['d1'],
    coverage: { a: 'complete', b: 'partial', c: 'unscanned', d: 'unscanned' },
    results: [],
    classesTotal: 4,
  });
  assert.equal(r.reach.coverage.unscanned, 2);
});

test('scanned list excludes unscanned classes and sorts keys', () => {
  const r = buildRunRecord({
    at: '2024-01-01T00:00:00Z',
    tree: 'abc123',
    taxonomy: 't1',
    bindingsHash: 'hash1',
    detectors: ['d1'],
    coverage: { z: 'complete', a: 'partial', m: 'unscanned', b: 'unspecified' },
    results: [],
    classesTotal: 4,
  });
  assert.deepEqual(r.reach.scanned, ["a", "b", "z"]);
});

test('statement reports unscanned count and total classes', () => {
  const r = buildRunRecord({
    at: '2024-01-01T00:00:00Z',
    tree: 'abc123',
    taxonomy: 't1',
    bindingsHash: 'hash1',
    detectors: ['d1'],
    coverage: { a: 'complete', b: 'unscanned', c: 'unscanned' },
    results: [],
    classesTotal: 3,
  });
  assert.equal(r.reach.statement, "2 of 3 classes were NOT SCANNED. Their absence from these results is absence of evidence, not evidence of absence.");
});

test('counts with single finding increments finding by one', () => {
  const results = [{ adjudication: 'finding' }];
  const r = buildRunRecord({
    at: '2024-01-01T00:00:00Z',
    tree: 'abc123',
    taxonomy: 't1',
    bindingsHash: 'hash1',
    detectors: ['d1'],
    coverage: { a: 'complete' },
    results,
    classesTotal: 1,
  });
  assert.deepEqual(r.counts, { finding: 1, undetermined: 0, accepted: 0, baseline: 0 });
});

test('empty results yields zero counts for all adjudications', () => {
  const r = buildRunRecord({
    at: '2024-01-01T00:00:00Z',
    tree: 'abc123',
    taxonomy: 't1',
    bindingsHash: 'hash1',
    detectors: ['d1'],
    coverage: { a: 'complete' },
    results: [],
    classesTotal: 1,
  });
  assert.deepEqual(r.counts, { finding: 0, undetermined: 0, accepted: 0, baseline: 0 });
});
