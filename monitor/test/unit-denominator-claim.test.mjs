// Computes denominator coverage, determined coverage, and zero-is-population-zero flags (monitor/denominator.mjs claim).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claim } from '../denominator.mjs';

test('rejects negative count', () => {
  assert.throws(() => claim({ count: -1 }), { name: 'Error', message: 'denominator: count must be a non-negative finite number, got -1' });
});

test('rejects non-finite count', () => {
  assert.throws(() => claim({ count: NaN }), { name: 'Error', message: 'denominator: count must be a non-negative finite number, got null' });
});

test('rejects negative observed', () => {
  assert.throws(() => claim({ count: 1, observed: -1, population: 10 }), { name: 'Error', message: 'denominator: observed must be a non-negative finite number or null, got -1' });
});

test('rejects negative population', () => {
  assert.throws(() => claim({ count: 1, observed: 5, population: -1 }), { name: 'Error', message: 'denominator: population must be a non-negative finite number or null, got -1' });
});

test('rejects observed exceeding population', () => {
  assert.throws(() => claim({ count: 1, observed: 11, population: 10 }), { name: 'Error', message: 'denominator: observed (11) exceeds population (10) \u2014 the denominator is wrong, and a coverage above 1 would render as certainty' });
});

test('returns zero coverage when population is zero', () => {
  const r = claim({ count: 0, observed: 0, population: 0 });
  assert.deepEqual(r, { count: 0, observed: 0, population: 0, undetermined: 0, unit: "unit", of: "finding", coverage: 0, determinedCoverage: 0, complete: false, zeroIsPopulationZero: false, floor: true });
});

test('returns null coverage when population is null', () => {
  const r = claim({ count: 1, observed: 5, population: null });
  assert.deepEqual(r, { count: 1, observed: 5, population: null, undetermined: 0, unit: "unit", of: "finding", coverage: null, determinedCoverage: null, complete: false, zeroIsPopulationZero: null, floor: true });
});

test('returns null coverage when observed is null', () => {
  const r = claim({ count: 1, observed: null, population: 10 });
  assert.deepEqual(r, { count: 1, observed: null, population: 10, undetermined: 0, unit: "unit", of: "finding", coverage: null, determinedCoverage: null, complete: false, zeroIsPopulationZero: null, floor: true });
});

test('computes coverage and determined coverage with undetermined', () => {
  const r = claim({ count: 2, observed: 8, population: 10, undetermined: 3 });
  assert.deepEqual(r, { count: 2, observed: 8, population: 10, undetermined: 3, unit: "unit", of: "finding", coverage: 0.8, determinedCoverage: 0.5, complete: false, zeroIsPopulationZero: null, floor: true });
});

test('marks complete when determined coverage is 1', () => {
  const r = claim({ count: 0, observed: 10, population: 10, undetermined: 0 });
  assert.deepEqual(r, { count: 0, observed: 10, population: 10, undetermined: 0, unit: "unit", of: "finding", coverage: 1, determinedCoverage: 1, complete: true, zeroIsPopulationZero: true, floor: false });
});
