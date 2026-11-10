// Decides whether a claim is publishable, wrapping zero-count incomplete claims as unknown (monitor/denominator.mjs publishable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishable } from '../denominator.mjs';

test('returns the claim unchanged when count is zero and complete is true', () => {
  const c = { count: 0, observed: 10, population: 10, undetermined: 0, unit: 'file', of: 'finding', coverage: 1, determinedCoverage: 1, complete: true, zeroIsPopulationZero: true, floor: false };
  assert.deepEqual(publishable(c), { count: 0, observed: 10, population: 10, undetermined: 0, unit: "file", of: "finding", coverage: 1, determinedCoverage: 1, complete: true, zeroIsPopulationZero: true, floor: false });
});

test('returns the claim unchanged when count is non-zero and complete is false', () => {
  const c = { count: 5, observed: 10, population: 20, undetermined: 0, unit: 'file', of: 'finding', coverage: 0.5, determinedCoverage: 0.5, complete: false, zeroIsPopulationZero: null, floor: true };
  assert.deepEqual(publishable(c), { count: 5, observed: 10, population: 20, undetermined: 0, unit: "file", of: "finding", coverage: 0.5, determinedCoverage: 0.5, complete: false, zeroIsPopulationZero: null, floor: true });
});

test('returns the claim unchanged when count is non-zero and complete is true', () => {
  const c = { count: 3, observed: 10, population: 10, undetermined: 0, unit: 'file', of: 'finding', coverage: 1, determinedCoverage: 1, complete: true, zeroIsPopulationZero: null, floor: false };
  assert.deepEqual(publishable(c), { count: 3, observed: 10, population: 10, undetermined: 0, unit: "file", of: "finding", coverage: 1, determinedCoverage: 1, complete: true, zeroIsPopulationZero: null, floor: false });
});

test('wraps zero count with incomplete coverage and null determinedCoverage as unknown', () => {
  const c = { count: 0, observed: null, population: null, undetermined: 0, unit: 'file', of: 'finding', coverage: null, determinedCoverage: null, complete: false, zeroIsPopulationZero: null, floor: true };
  assert.deepEqual(publishable(c), { unknown: true, unknownReason: "unexaminable", unknownDetail: "0 finding(s) over an unknown fraction of an unknown file(s)", claim: { count: 0, observed: null, population: null, undetermined: 0, unit: "file", of: "finding", coverage: null, determinedCoverage: null, complete: false, zeroIsPopulationZero: null, floor: true } });
});

test('wraps zero count with incomplete coverage and numeric determinedCoverage as unknown', () => {
  const c = { count: 0, observed: 5, population: 10, undetermined: 0, unit: 'file', of: 'finding', coverage: 0.5, determinedCoverage: 0.5, complete: false, zeroIsPopulationZero: null, floor: true };
  assert.deepEqual(publishable(c), { unknown: true, unknownReason: "unexaminable", unknownDetail: "0 finding(s) over 50.0% of 10 file(s)", claim: { count: 0, observed: 5, population: 10, undetermined: 0, unit: "file", of: "finding", coverage: 0.5, determinedCoverage: 0.5, complete: false, zeroIsPopulationZero: null, floor: true } });
});

test('wraps zero count with incomplete coverage and zero determinedCoverage as unknown', () => {
  const c = { count: 0, observed: 0, population: 10, undetermined: 0, unit: 'file', of: 'finding', coverage: 0, determinedCoverage: 0, complete: false, zeroIsPopulationZero: null, floor: true };
  assert.deepEqual(publishable(c), { unknown: true, unknownReason: "unexaminable", unknownDetail: "0 finding(s) over 0.0% of 10 file(s)", claim: { count: 0, observed: 0, population: 10, undetermined: 0, unit: "file", of: "finding", coverage: 0, determinedCoverage: 0, complete: false, zeroIsPopulationZero: null, floor: true } });
});
