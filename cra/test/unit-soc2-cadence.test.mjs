// Cadence intervals and gaps from sweep history (cra/soc2.mjs cadence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cadence } from '../soc2.mjs';

test('returns zero runs and null boundaries for empty history', () => {
  const result = cadence([], '2024-01-01T00:00:00Z', '2024-01-10T00:00:00Z');
  assert.deepEqual(result, {
    runs: 0,
    first: null,
    last: null,
    maxGapDays: 2,
    gaps: [],
    rows: []
  });
});

test('returns zero runs when history is null', () => {
  const result = cadence(null, '2024-01-01T00:00:00Z', '2024-01-10T00:00:00Z');
  assert.equal(result.runs, 0);
  assert.equal(result.first, null);
  assert.equal(result.last, null);
  assert.equal(result.gaps.length, 0);
});

test('filters out rows before period start and after atIso', () => {
  const rows = [
    { generated: '2023-12-31T00:00:00Z' },
    { generated: '2024-01-05T00:00:00Z' },
    { generated: '2024-01-15T00:00:00Z' }
  ];
  const result = cadence(rows, '2024-01-01T00:00:00Z', '2024-01-10T00:00:00Z');
  assert.equal(result.runs, 1);
  assert.equal(result.first, '2024-01-05T00:00:00Z');
  assert.equal(result.last, '2024-01-05T00:00:00Z');
  assert.equal(result.gaps.length, 1);
  assert.deepEqual(result.gaps[0], {
    from: '2024-01-05T00:00:00Z',
    to: '2024-01-10T00:00:00Z',
    days: 5.0,
    openEnded: true
  });
});

test('includes rows exactly at period start and atIso boundaries', () => {
  const rows = [
    { generated: '2024-01-01T00:00:00Z' },
    { generated: '2024-01-10T00:00:00Z' }
  ];
  const result = cadence(rows, '2024-01-01T00:00:00Z', '2024-01-10T00:00:00Z');
  assert.equal(result.runs, 2);
  assert.equal(result.first, '2024-01-01T00:00:00Z');
  assert.equal(result.last, '2024-01-10T00:00:00Z');
  assert.equal(result.gaps.length, 1);
  assert.deepEqual(result.gaps[0], {
    from: '2024-01-01T00:00:00Z',
    to: '2024-01-10T00:00:00Z',
    days: 9.0
  });
});

test('does not flag gap equal to maxGapDays as exception', () => {
  const rows = [
    { generated: '2024-01-01T00:00:00Z' },
    { generated: '2024-01-03T00:00:00Z' }
  ];
  const result = cadence(rows, '2024-01-01T00:00:00Z', '2024-01-03T00:00:00Z');
  assert.equal(result.runs, 2);
  assert.equal(result.gaps.length, 0);
});

test('flags gap exceeding maxGapDays between runs', () => {
  const rows = [
    { generated: '2024-01-01T00:00:00Z' },
    { generated: '2024-01-04T00:00:00Z' }
  ];
  const result = cadence(rows, '2024-01-01T00:00:00Z', '2024-01-04T00:00:00Z');
  assert.equal(result.runs, 2);
  assert.equal(result.gaps.length, 1);
  assert.deepEqual(result.gaps[0], {
    from: '2024-01-01T00:00:00Z',
    to: '2024-01-04T00:00:00Z',
    days: 3.0
  });
});

test('flags open-ended gap when time since last run exceeds maxGapDays', () => {
  const rows = [
    { generated: '2024-01-01T00:00:00Z' }
  ];
  const result = cadence(rows, '2024-01-01T00:00:00Z', '2024-01-05T00:00:00Z');
  assert.equal(result.runs, 1);
  assert.equal(result.gaps.length, 1);
  assert.deepEqual(result.gaps[0], {
    from: '2024-01-01T00:00:00Z',
    to: '2024-01-05T00:00:00Z',
    days: 4.0,
    openEnded: true
  });
});

test('does not flag open-ended gap when time since last run equals maxGapDays', () => {
  const rows = [
    { generated: '2024-01-01T00:00:00Z' }
  ];
  const result = cadence(rows, '2024-01-01T00:00:00Z', '2024-01-03T00:00:00Z');
  assert.equal(result.runs, 1);
  assert.equal(result.gaps.length, 0);
});

test('sorts rows chronologically and computes multiple gaps', () => {
  const rows = [
    { generated: '2024-01-05T00:00:00Z' },
    { generated: '2024-01-01T00:00:00Z' },
    { generated: '2024-01-08T00:00:00Z' }
  ];
  const result = cadence(rows, '2024-01-01T00:00:00Z', '2024-01-08T00:00:00Z');
  assert.equal(result.runs, 3);
  assert.equal(result.first, '2024-01-01T00:00:00Z');
  assert.equal(result.last, '2024-01-08T00:00:00Z');
  assert.equal(result.gaps.length, 2);
  assert.deepEqual(result.gaps[0], {
    from: '2024-01-01T00:00:00Z',
    to: '2024-01-05T00:00:00Z',
    days: 4.0
  });
  assert.deepEqual(result.gaps[1], {
    from: '2024-01-05T00:00:00Z',
    to: '2024-01-08T00:00:00Z',
    days: 3.0
  });
});
