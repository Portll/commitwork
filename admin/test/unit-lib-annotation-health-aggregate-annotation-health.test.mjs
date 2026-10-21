// Fleet aggregate of annotation statuses: orphaned, expired, invalid, and bound count (admin/lib/annotation-health.mjs aggregateAnnotationHealth).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateAnnotationHealth } from '../lib/annotation-health.mjs';

test('returns empty aggregates when input is null', () => {
  const result = aggregateAnnotationHealth(null);
  assert.deepEqual(result, { orphaned: [], expired: [], invalid: [], boundCount: 0 });
});

test('returns empty aggregates when input is undefined', () => {
  const result = aggregateAnnotationHealth();
  assert.deepEqual(result, { orphaned: [], expired: [], invalid: [], boundCount: 0 });
});

test('skips entries with missing status', () => {
  const perArea = [
    { slug: 'area1', status: null },
    { slug: 'area2' }
  ];
  const result = aggregateAnnotationHealth(perArea);
  assert.deepEqual(result, { orphaned: [], expired: [], invalid: [], boundCount: 0 });
});

test('counts applied records as bound', () => {
  const perArea = [
    { slug: 'area1', status: { applied: [{ record: 'rec1' }] } }
  ];
  const result = aggregateAnnotationHealth(perArea);
  assert.equal(result.boundCount, 1);
  assert.deepEqual(result.orphaned, []);
});

test('counts carried records as bound', () => {
  const perArea = [
    { slug: 'area1', status: { carried: [{ record: 'rec1' }] } }
  ];
  const result = aggregateAnnotationHealth(perArea);
  assert.equal(result.boundCount, 1);
  assert.deepEqual(result.orphaned, []);
});

test('identifies orphaned records that noMatch in all areas and are never bound', () => {
  const perArea = [
    { slug: 'area1', status: { noMatch: [{ record: 'rec1' }] } },
    { slug: 'area2', status: { noMatch: [{ record: 'rec1' }] } }
  ];
  const result = aggregateAnnotationHealth(perArea);
  assert.deepEqual(result.orphaned, [{ record: 'rec1', areas: ['area1', 'area2'] }]);
  assert.equal(result.boundCount, 0);
});

test('does not mark as orphaned if record is bound in any area', () => {
  const perArea = [
    { slug: 'area1', status: { noMatch: [{ record: 'rec1' }] } },
    { slug: 'area2', status: { carried: [{ record: 'rec1' }] } }
  ];
  const result = aggregateAnnotationHealth(perArea);
  assert.deepEqual(result.orphaned, []);
  assert.equal(result.boundCount, 1);
});

test('collects expired records with area context', () => {
  const perArea = [
    { slug: 'area1', status: { expired: [{ record: 'rec1', expires: '2026-01-01' }] } }
  ];
  const result = aggregateAnnotationHealth(perArea);
  assert.deepEqual(result.expired, [{ record: 'rec1', expires: '2026-01-01', area: 'area1' }]);
});

test('collects invalid records with area context', () => {
  const perArea = [
    { slug: 'area1', status: { invalid: [{ record: 'rec1', errors: ['bad'] }] } }
  ];
  const result = aggregateAnnotationHealth(perArea);
  assert.deepEqual(result.invalid, [{ record: 'rec1', errors: ['bad'], area: 'area1' }]);
});

test('deduplicates noMatch areas for the same record', () => {
  const perArea = [
    { slug: 'area1', status: { noMatch: [{ record: 'rec1' }] } },
    { slug: 'area1', status: { noMatch: [{ record: 'rec1' }] } }
  ];
  const result = aggregateAnnotationHealth(perArea);
  assert.deepEqual(result.orphaned, [{ record: 'rec1', areas: ['area1'] }]);
});
