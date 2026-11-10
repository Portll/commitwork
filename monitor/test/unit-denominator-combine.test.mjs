// aggregates multiple denominator claims into a single claim (monitor/denominator.mjs combine)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combine } from '../denominator.mjs';

test('combine returns zero claim when given an empty array', () => {
  const result = combine([]);
  assert.deepEqual(result, { count: 0, observed: 0, population: 0, undetermined: 0, unit: "unit", of: "finding", coverage: 0, determinedCoverage: 0, complete: false, zeroIsPopulationZero: false, floor: true });
});

test('combine sums count, observed and population when all values are present', () => {
  const claims = [
    { count: 2, observed: 5, population: 10, undetermined: 1 },
    { count: 3, observed: 7, population: 14, undetermined: 0 },
  ];
  const result = combine(claims);
  assert.deepEqual(result, { count: 5, observed: 12, population: 24, undetermined: 1, unit: "unit", of: "finding", coverage: 0.5, determinedCoverage: 0.4583, complete: false, zeroIsPopulationZero: null, floor: true });
});

test('combine produces null population when any claim has unknown population', () => {
  const claims = [
    { count: 1, observed: 2, population: null, undetermined: 0 },
    { count: 4, observed: 8, population: 12, undetermined: 2 },
  ];
  const result = combine(claims);
  assert.deepEqual(result, { count: 5, observed: 10, population: null, undetermined: 2, unit: "unit", of: "finding", coverage: null, determinedCoverage: null, complete: false, zeroIsPopulationZero: null, floor: true });
});

test('combine yields null observed when any claim has unknown observed', () => {
  const claims = [
    { count: 1, observed: null, population: 5, undetermined: 0 },
    { count: 2, observed: 3, population: 6, undetermined: 1 },
  ];
  const result = combine(claims);
  assert.deepEqual(result, { count: 3, observed: null, population: 11, undetermined: 1, unit: "unit", of: "finding", coverage: null, determinedCoverage: null, complete: false, zeroIsPopulationZero: null, floor: true });
});

test('combine correctly aggregates undetermined values from multiple claims', () => {
  const claims = [
    { count: 1, observed: 2, population: 4, undetermined: 1 },
    { count: 2, observed: 3, population: 6, undetermined: 2 },
    { count: 0, observed: 0, population: 0, undetermined: 0 },
  ];
  const result = combine(claims);
  assert.deepEqual(result, { count: 3, observed: 5, population: 10, undetermined: 3, unit: "unit", of: "finding", coverage: 0.5, determinedCoverage: 0.2, complete: false, zeroIsPopulationZero: null, floor: true });
});

test('combine respects custom unit and of parameters while aggregating', () => {
  const claims = [
    { count: 5, observed: 10, population: 20, undetermined: 0 },
  ];
  const result = combine(claims, { unit: 'file', of: 'issue' });
  assert.deepEqual(result, { count: 5, observed: 10, population: 20, undetermined: 0, unit: "file", of: "issue", coverage: 0.5, determinedCoverage: 0.5, complete: false, zeroIsPopulationZero: null, floor: true });
});

test('combine handles mixture of zero and non-zero counts', () => {
  const claims = [
    { count: 0, observed: 0, population: 0, undetermined: 0 },
    { count: 3, observed: 6, population: 9, undetermined: 1 },
  ];
  const result = combine(claims);
  assert.deepEqual(result, { count: 3, observed: 6, population: 9, undetermined: 1, unit: "unit", of: "finding", coverage: 0.6667, determinedCoverage: 0.5556, complete: false, zeroIsPopulationZero: null, floor: true });
});

test('combine works when all claims have null observed and null population', () => {
  const claims = [
    { count: 2, observed: null, population: null, undetermined: 0 },
    { count: 3, observed: null, population: null, undetermined: 1 },
  ];
  const result = combine(claims);
  assert.deepEqual(result, { count: 5, observed: null, population: null, undetermined: 1, unit: "unit", of: "finding", coverage: null, determinedCoverage: null, complete: false, zeroIsPopulationZero: null, floor: true });
});
