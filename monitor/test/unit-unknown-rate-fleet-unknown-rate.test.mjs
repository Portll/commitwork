// Fleet-wide unknown totals by reason and by category, plus the combined cell claim (monitor/unknown-rate.mjs fleetUnknownRate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetUnknownRate } from '../unknown-rate.mjs';

const OF = 'published scanner cell carrying an unknown';
const zeroClaim = () => ({
  count: 0,
  observed: 0,
  population: 0,
  undetermined: 0,
  unit: 'cell',
  of: OF,
  coverage: 0,
  determinedCoverage: 0,
  complete: false,
  zeroIsPopulationZero: false,
  floor: true,
});
const area = (byReason, byCategory) => ({ byReason, byCategory, claim: zeroClaim() });

test('An empty fleet yields a zero cell claim and empty reason and category maps', () => {
  const input = [];
  const result = fleetUnknownRate(input);
  assert.deepEqual(result, { fleet: zeroClaim(), byReason: {}, byCategory: {} });
});

test('An area with empty maps contributes no reasons and no categories', () => {
  const input = [area({}, {})];
  const result = fleetUnknownRate(input);
  assert.deepEqual(result.byReason, {});
  assert.deepEqual(result.byCategory, {});
});

test('A reason seen once keeps its count unchanged', () => {
  const input = [area({ x: 3 }, {})];
  const result = fleetUnknownRate(input);
  assert.deepEqual(result.byReason, { x: 3 });
});

test('The same reason in two areas is summed and other reasons stay separate', () => {
  const input = [area({ x: 1 }, {}), area({ x: 2, y: 5 }, {})];
  const result = fleetUnknownRate(input);
  assert.deepEqual(result.byReason, { x: 3, y: 5 });
});

test('A reason first counted as zero still sums with a later area', () => {
  const input = [area({ x: 0 }, {}), area({ x: 4 }, {})];
  const result = fleetUnknownRate(input);
  assert.deepEqual(result.byReason, { x: 4 });
});

test('A category seen once keeps its cells and unknown counts unchanged', () => {
  const input = [area({}, { c: { cells: 5, unknown: 2 } })];
  const result = fleetUnknownRate(input);
  assert.deepEqual(result.byCategory, { c: { cells: 5, unknown: 2 } });
});

test('The same category in two areas sums cells and unknown separately', () => {
  const input = [
    area({}, { c: { cells: 5, unknown: 2 } }),
    area({}, { c: { cells: 3, unknown: 1 }, d: { cells: 4, unknown: 0 } }),
  ];
  const result = fleetUnknownRate(input);
  assert.deepEqual(result.byCategory, { c: { cells: 8, unknown: 3 }, d: { cells: 4, unknown: 0 } });
});

test('A category first seen with zero cells and zero unknown still sums with a later area', () => {
  const input = [area({}, { c: { cells: 0, unknown: 0 } }), area({}, { c: { cells: 7, unknown: 3 } })];
  const result = fleetUnknownRate(input);
  assert.deepEqual(result.byCategory, { c: { cells: 7, unknown: 3 } });
});

test('Reason and category keys come out in ascending order', () => {
  const input = [
    area({ z: 1, a: 2, m: 3 }, { b: { cells: 1, unknown: 1 }, a: { cells: 2, unknown: 0 } }),
  ];
  const result = fleetUnknownRate(input);
  assert.deepEqual(Object.keys(result.byReason), ['a', 'm', 'z']);
  assert.deepEqual(Object.keys(result.byCategory), ['a', 'b']);
  assert.deepEqual(result.byReason, { a: 2, m: 3, z: 1 });
  assert.deepEqual(result.byCategory, { a: { cells: 2, unknown: 0 }, b: { cells: 1, unknown: 1 } });
});

test('An area without a byReason map throws a TypeError', () => {
  const input = [{ byCategory: {}, claim: zeroClaim() }];
  assert.throws(() => fleetUnknownRate(input), {
    name: 'TypeError',
    message: 'Cannot convert undefined or null to object',
  });
});
