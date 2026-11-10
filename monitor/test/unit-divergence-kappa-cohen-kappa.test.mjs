// Cohen kappa agreement between two engines (monitor/divergence-kappa.mjs cohenKappa).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cohenKappa } from '../divergence-kappa.mjs';

test('returns no pairs object for empty input', () => {
  const r = cohenKappa([]);
  assert.deepEqual(r, { n: 0, observed: null, chance: null, kappa: null, why: "no pairs" });
});

test('returns no pairs object for single pair', () => {
  const r = cohenKappa([{ a: 'x', b: 'x' }]);
  assert.deepEqual(r, { n: 1, observed: 1, chance: 1, kappa: null, why: "both engines gave every pair the same single class, so chance agreement is 1 and kappa is undefined" });
});

test('returns undefined kappa when both engines give same single class', () => {
  const pairs = Array.from({ length: 5 }, () => ({ a: 'A', b: 'A' }));
  const r = cohenKappa(pairs);
  assert.deepEqual(r, { n: 5, observed: 1, chance: 1, kappa: null, why: "both engines gave every pair the same single class, so chance agreement is 1 and kappa is undefined" });
});

test('computes kappa for mixed agreement', () => {
  const pairs = [
    { a: 'A', b: 'A' },
    { a: 'A', b: 'B' },
    { a: 'B', b: 'A' },
    { a: 'B', b: 'B' }
  ];
  const r = cohenKappa(pairs);
  assert.deepEqual(r, { n: 4, observed: 0.5, chance: 0.5, kappa: 0 });
});

test('computes kappa with no agreement', () => {
  const pairs = [
    { a: 'A', b: 'B' },
    { a: 'B', b: 'A' }
  ];
  const r = cohenKappa(pairs);
  assert.deepEqual(r, { n: 2, observed: 0, chance: 0.5, kappa: -1 });
});

test('computes kappa with three classes', () => {
  const pairs = [
    { a: 'A', b: 'A' },
    { a: 'A', b: 'B' },
    { a: 'B', b: 'B' },
    { a: 'B', b: 'C' },
    { a: 'C', b: 'C' }
  ];
  const r = cohenKappa(pairs);
  assert.deepEqual(r, { n: 5, observed: 0.6, chance: 0.32, kappa: 0.4118 });
});

test('computes kappa with asymmetric class distributions', () => {
  const pairs = [
    { a: 'A', b: 'A' },
    { a: 'A', b: 'A' },
    { a: 'A', b: 'B' },
    { a: 'B', b: 'B' },
    { a: 'B', b: 'A' },
    { a: 'C', b: 'C' }
  ];
  const r = cohenKappa(pairs);
  assert.deepEqual(r, { n: 6, observed: 0.6667, chance: 0.3889, kappa: 0.4545 });
});

test('computes kappa with repeated identical pairs', () => {
  const pairs = Array.from({ length: 10 }, (_, i) => ({ a: i % 2 === 0 ? 'X' : 'Y', b: i % 3 === 0 ? 'X' : 'Y' }));
  const r = cohenKappa(pairs);
  assert.deepEqual(r, { n: 10, observed: 0.5, chance: 0.5, kappa: 0 });
});
