// Computes whether a coverage dip recovered or is a loss (bin/gate-tests-core.mjs coverageVerdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageVerdict } from '../gate-tests-core.mjs';

test('byTotal true with second.tests equal to base.tests returns transient exit 0', () => {
  const r = coverageVerdict(1, { tests: 5 }, { tests: 5 });
  assert.deepEqual(r, { verdict: "coverage-transient", dip: 1, recovered: 5, exit: 0 });
});

test('byTotal true with second.tests one less than base.tests returns loss exit 2', () => {
  const r = coverageVerdict(1, { tests: 4 }, { tests: 5 });
  assert.deepEqual(r, { verdict: "coverage-loss", fromPass: 5, toPass: 4, exit: 2 });
});

test('byTotal false with second.pass equal to base.pass returns transient exit 0', () => {
  const r = coverageVerdict(1, { pass: 3 }, { pass: 3 });
  assert.deepEqual(r, { verdict: "coverage-transient", dip: 1, recovered: 3, exit: 0 });
});

test('byTotal false with second.pass one less than base.pass returns loss exit 2', () => {
  const r = coverageVerdict(1, { pass: 2 }, { pass: 3 });
  assert.deepEqual(r, { verdict: "coverage-loss", fromPass: 3, toPass: 2, exit: 2 });
});

test('byTotal false with second.pass null returns loss with toPass from firstPass', () => {
  const r = coverageVerdict(7, { pass: null }, { pass: 3 });
  assert.deepEqual(r, { verdict: "coverage-loss", fromPass: 3, toPass: 7, exit: 2 });
});

test('byTotal false with second.pass greater than base.pass returns transient exit 0', () => {
  const r = coverageVerdict(1, { pass: 4 }, { pass: 3 });
  assert.deepEqual(r, { verdict: "coverage-transient", dip: 1, recovered: 4, exit: 0 });
});

test('byTotal true with second.tests greater than base.tests returns transient exit 0', () => {
  const r = coverageVerdict(1, { tests: 6 }, { tests: 5 });
  assert.deepEqual(r, { verdict: "coverage-transient", dip: 1, recovered: 6, exit: 0 });
});

test('byTotal false with second.pass undefined returns loss with toPass from firstPass', () => {
  const r = coverageVerdict(9, { pass: undefined }, { pass: 3 });
  assert.deepEqual(r, { verdict: "coverage-loss", fromPass: 3, toPass: 9, exit: 2 });
});
