import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canaryRates } from '../../lib/security-canary-rates.mjs';

const row = (id, lane, expected, observed, ran = true) => ({ id, lane, expected, observed, ran });
const laneOf = (r, name) => r.lanes.find((l) => l.lane === name);

test('false clean and false alarm are counted against separate denominators', () => {
  const r = canaryRates([
    row('1', 'A', 'finding', 'finding'),
    row('2', 'A', 'finding', 'clean'),
    row('3', 'A', 'clean', 'clean'),
    row('4', 'A', 'clean', 'finding'),
  ]);
  const expected = { positives: 2, negatives: 2, falseClean: 1, falseAlarm: 1, unknown: 0, notRun: 0, falseCleanRate: 0.5, falseAlarmRate: 0.5 };
  assert.deepEqual(laneOf(r, 'A'), { lane: 'A', ...expected });
  assert.deepEqual(r.total, expected);
});

test('totals aggregate across lanes and lanes come back sorted', () => {
  const r = canaryRates([row('1', 'zeta', 'finding', 'clean'), row('2', 'alpha', 'clean', 'finding'), row('3', 'alpha', 'clean', 'clean')]);
  assert.deepEqual(r.lanes.map((l) => l.lane), ['alpha', 'zeta']);
  assert.equal(laneOf(r, 'zeta').falseCleanRate, 1);
  assert.equal(laneOf(r, 'alpha').falseAlarmRate, 0.5);
  assert.equal(r.total.falseCleanRate, 1);
  assert.equal(r.total.falseAlarmRate, 0.5);
});

test('unknown results stay out of both denominators', () => {
  const r = canaryRates([row('1', 'A', 'finding', 'unknown'), row('2', 'A', 'clean', 'unknown'), row('3', 'A', 'finding', 'finding')]);
  const a = laneOf(r, 'A');
  assert.equal(a.positives, 1);
  assert.equal(a.negatives, 0);
  assert.equal(a.unknown, 2);
  assert.equal(a.falseCleanRate, 0);
  assert.equal(a.falseAlarmRate, null);
});

test('a canary that did not run is not a correct negative', () => {
  const r = canaryRates([row('1', 'A', 'clean', 'unknown', false), row('2', 'A', 'finding', 'unknown', false)]);
  const a = laneOf(r, 'A');
  assert.equal(a.notRun, 2);
  assert.equal(a.negatives, 0);
  assert.equal(a.positives, 0);
  assert.equal(a.falseAlarmRate, null);
  assert.equal(a.falseCleanRate, null);
});

test('a verdict on a canary that did not run is refused as contradictory', () => {
  assert.throws(() => canaryRates([row('1', 'A', 'clean', 'clean', false)]), /observed clean on a canary that did not run/);
  assert.throws(() => canaryRates([row('1', 'A', 'finding', 'finding', false)]), /did not run/);
});

test('rates are null when nothing is eligible, zero when eligible and all correct', () => {
  assert.equal(laneOf(canaryRates([row('1', 'A', 'clean', 'clean')]), 'A').falseCleanRate, null);
  assert.equal(laneOf(canaryRates([row('1', 'A', 'clean', 'clean')]), 'A').falseAlarmRate, 0);
  assert.deepEqual(canaryRates([]), { lanes: [], total: { positives: 0, negatives: 0, falseClean: 0, falseAlarm: 0, unknown: 0, notRun: 0, falseCleanRate: null, falseAlarmRate: null } });
});

test('a lane named like an object prototype key is an ordinary lane', () => {
  const r = canaryRates([row('1', '__proto__', 'finding', 'clean'), row('2', 'constructor', 'clean', 'clean')]);
  assert.deepEqual(r.lanes.map((l) => l.lane), ['__proto__', 'constructor']);
  assert.equal(laneOf(r, '__proto__').falseClean, 1);
  assert.equal(Object.getPrototypeOf(r), Object.prototype);
});

test('output does not depend on row order', () => {
  const rows = [row('1', 'B', 'finding', 'clean'), row('2', 'A', 'clean', 'unknown'), row('3', 'A', 'clean', 'unknown', false)];
  assert.deepEqual(canaryRates(rows), canaryRates([...rows].reverse()));
});

test('malformed and duplicate rows are refused', () => {
  assert.throws(() => canaryRates('rows'), /rows must be an array/);
  assert.throws(() => canaryRates([null]), /rows\[0\] must be an object/);
  assert.throws(() => canaryRates([{ lane: 'A', expected: 'clean', observed: 'clean', ran: true }]), /id must be a non-empty string/);
  assert.throws(() => canaryRates([row('1', 'A', 'clean', 'clean'), row('1', 'B', 'clean', 'clean')]), /duplicate canary id/);
  assert.throws(() => canaryRates([row('1', '', 'clean', 'clean')]), /lane must be a non-empty string/);
  assert.throws(() => canaryRates([row('1', 'A', 'maybe', 'clean')]), /expected must be finding or clean/);
  assert.throws(() => canaryRates([row('1', 'A', 'clean', 'pass')]), /observed must be/);
  assert.throws(() => canaryRates([{ ...row('1', 'A', 'clean', 'clean'), ran: 'true' }]), /ran must be a boolean/);
});
