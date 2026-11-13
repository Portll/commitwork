// computes per-lane and total canary statistics (lib/security-canary-rates.mjs canaryRates)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canaryRates } from '../security-canary-rates.mjs';

test('returns rates object for a single valid canary', () => {
  const input = [
    { id: 'c1', lane: 'alpha', expected: 'finding', observed: 'clean', ran: true },
  ];
  const result = canaryRates(input);
  assert.deepEqual(result, { lanes: [{ lane: "alpha", positives: 1, negatives: 0, falseClean: 1, falseAlarm: 0, unknown: 0, notRun: 0, falseCleanRate: 1, falseAlarmRate: null }], total: { positives: 1, negatives: 0, falseClean: 1, falseAlarm: 0, unknown: 0, notRun: 0, falseCleanRate: 1, falseAlarmRate: null } });
});

test('throws TypeError when rows is not an array', () => {
  assert.throws(
    () => canaryRates({}),
    { name: 'TypeError', message: 'rows must be an array' }
  );
});

test('throws TypeError when a row is not an object', () => {
  const input = [null];
  assert.throws(
    () => canaryRates(input),
    { name: 'TypeError', message: 'rows[0] must be an object' }
  );
});

test('throws Error on duplicate canary id', () => {
  const input = [
    { id: 'dup', lane: 'a', expected: 'clean', observed: 'clean', ran: true },
    { id: 'dup', lane: 'b', expected: 'clean', observed: 'clean', ran: true },
  ];
  assert.throws(
    () => canaryRates(input),
    { name: 'Error', message: 'duplicate canary id: dup' }
  );
});

test('throws TypeError when expected value is invalid', () => {
  const input = [
    { id: 'bad', lane: 'a', expected: 'unknown', observed: 'clean', ran: true },
  ];
  assert.throws(
    () => canaryRates(input),
    { name: 'TypeError', message: 'bad: expected must be finding or clean' }
  );
});

test('throws TypeError when observed value is invalid', () => {
  const input = [
    { id: 'badObs', lane: 'a', expected: 'clean', observed: 'foo', ran: true },
  ];
  assert.throws(
    () => canaryRates(input),
    { name: 'TypeError', message: 'badObs: observed must be finding, clean or unknown' }
  );
});

test('throws TypeError when ran is not a boolean', () => {
  const input = [
    { id: 'badRan', lane: 'a', expected: 'clean', observed: 'clean', ran: 'yes' },
  ];
  assert.throws(
    () => canaryRates(input),
    { name: 'TypeError', message: 'badRan: ran must be a boolean' }
  );
});

test('throws Error when a non\u2011run canary has non\u2011unknown observed', () => {
  const input = [
    { id: 'notRun', lane: 'a', expected: 'clean', observed: 'clean', ran: false },
  ];
  assert.throws(
    () => canaryRates(input),
    { name: 'Error', message: 'notRun: observed clean on a canary that did not run' }
  );
});

test('throws TypeError when lane is not a non\u2011empty string (non\u2011string)', () => {
  const input = [
    { id: 'badLane', lane: 123, expected: 'clean', observed: 'clean', ran: true },
  ];
  assert.throws(
    () => canaryRates(input),
    { name: 'TypeError', message: 'badLane: lane must be a non-empty string' }
  );
});

test('throws TypeError when lane is an empty string', () => {
  const input = [
    { id: 'emptyLane', lane: '', expected: 'clean', observed: 'clean', ran: true },
  ];
  assert.throws(
    () => canaryRates(input),
    { name: 'TypeError', message: 'emptyLane: lane must be a non-empty string' }
  );
});
