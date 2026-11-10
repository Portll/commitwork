// Classifies test failures as committed, uncommitted, undetermined, or incomparable (bin/gate-tests-core.mjs regressionVerdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regressionVerdict } from '../gate-tests-core.mjs';

test('returns unattributed when head is null', () => {
  assert.deepEqual(regressionVerdict(['a'], null, { tests: 1 }), { verdict: "regression-unattributed", exit: 2 });
});

test('returns unattributed when head.fail is null', () => {
  assert.deepEqual(regressionVerdict(['a'], { fail: null, names: [], tests: 1 }, { tests: 1 }), { verdict: "regression-unattributed", exit: 2 });
});

test('returns unattributed when head.fail is a number', () => {
  assert.deepEqual(regressionVerdict(['a'], { fail: 1, names: [], tests: 1 }, { tests: 1 }), { verdict: "regression-uncommitted", committed: [], uncommitted: ["a"], undetermined: [], population: { tests: 1, headTests: 1, shortfall: 0 }, exit: 2 });
});

test('returns uncommitted when test absent from head and populations comparable', () => {
  assert.deepEqual(regressionVerdict(['a'], { fail: 1, names: [], tests: 1 }, { tests: 1 }), { verdict: "regression-uncommitted", committed: [], uncommitted: ["a"], undetermined: [], population: { tests: 1, headTests: 1, shortfall: 0 }, exit: 2 });
});

test('returns incomparable when head ran fewer tests than tree', () => {
  assert.deepEqual(regressionVerdict(['a'], { fail: 1, names: [], tests: 1 }, { tests: 2 }), { verdict: "regression-incomparable", committed: [], uncommitted: [], undetermined: ["a"], population: { tests: 2, headTests: 1, shortfall: 1 }, exit: 2 });
});

test('returns committed when test failed at head and populations equal', () => {
  assert.deepEqual(regressionVerdict(['a'], { fail: 1, names: ['a'], tests: 1 }, { tests: 1 }), { verdict: "regression-committed", committed: ["a"], uncommitted: [], undetermined: [], population: { tests: 1, headTests: 1, shortfall: 0 }, exit: 2 });
});

test('returns undetermined when head has degraded tests', () => {
  assert.deepEqual(regressionVerdict(['a'], { fail: 1, names: ['a'], tests: 1, degraded: ['x'] }, { tests: 1 }), { verdict: "regression-undetermined", committed: [], undetermined: ["a"], uncommitted: [], degraded: ["x"], population: null, exit: 2 });
});

test('returns uncommitted when head has degraded tests and no committed failures', () => {
  assert.deepEqual(regressionVerdict(['a'], { fail: 1, names: [], tests: 1, degraded: ['x'] }, { tests: 1 }), { verdict: "regression-uncommitted", committed: [], undetermined: [], uncommitted: ["a"], degraded: ["x"], population: null, exit: 2 });
});
