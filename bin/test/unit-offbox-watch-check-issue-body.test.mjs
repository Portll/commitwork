// Multi-line issue text listing state, ref, ages, alarm count and observed time (bin/offbox-watch-check.mjs issueBody).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueBody } from '../offbox-watch-check.mjs';

test('missing ages render as unknown and an empty alarms array renders as zero', () => {
  const r = issueBody({ state: 'ok', ledgerTip: 'tip1', alarms: [] }, '2024-01-01T00:00:00.000Z');
  assert.equal(r, [
    'state: ok',
    'ref: ad575d5b0e43452c',
    'ledger age: unknownh',
    'witness age: unknownh',
    'alarms carried: 0',
    'observed: 2024-01-01T00:00:00.000Z',
  ].join('\n'));
});

test('a missing ledger tip still produces a ref and two alarms are counted', () => {
  const r = issueBody({ state: 'warn', alarms: ['a', 'b'] }, '2024-01-02T00:00:00.000Z');
  assert.equal(r, [
    'state: warn',
    'ref: 717497455c27c382',
    'ledger age: unknownh',
    'witness age: unknownh',
    'alarms carried: 2',
    'observed: 2024-01-02T00:00:00.000Z',
  ].join('\n'));
});

test('numeric ages and the alarm count are rendered when provided', () => {
  const r = issueBody({ state: 'alert', ledgerTip: 'tip2', ledgerAgeH: 1.5, witnessAgeH: 2.5, alarms: ['x', 'y', 'z'] }, '2024-01-03T00:00:00.000Z');
  assert.equal(r, [
    'state: alert',
    'ref: 37e62c78c58d7c0e',
    'ledger age: 1.5h',
    'witness age: 2.5h',
    'alarms carried: 3',
    'observed: 2024-01-03T00:00:00.000Z',
  ].join('\n'));
});

test('zero ages render as 0h rather than unknown', () => {
  const r = issueBody({ state: 'ok', ledgerTip: 'tip3', ledgerAgeH: 0, witnessAgeH: 0, alarms: [] }, '2024-01-04T00:00:00.000Z');
  assert.equal(r, [
    'state: ok',
    'ref: 47c204c85319fd06',
    'ledger age: 0h',
    'witness age: 0h',
    'alarms carried: 0',
    'observed: 2024-01-04T00:00:00.000Z',
  ].join('\n'));
});

test('explicitly null ages render as unknown and a single alarm is counted', () => {
  const r = issueBody({ state: 'ok', ledgerTip: 'tip4', ledgerAgeH: null, witnessAgeH: null, alarms: ['only'] }, '2024-01-05T00:00:00.000Z');
  assert.equal(r, [
    'state: ok',
    'ref: f08d0fe7337f684d',
    'ledger age: unknownh',
    'witness age: unknownh',
    'alarms carried: 1',
    'observed: 2024-01-05T00:00:00.000Z',
  ].join('\n'));
});

test('a non-array alarms value is counted as zero', () => {
  const r = issueBody({ state: 'ok', ledgerTip: 'tip5', ledgerAgeH: 1, witnessAgeH: 1, alarms: 'not-an-array' }, '2024-01-06T00:00:00.000Z');
  assert.equal(r, [
    'state: ok',
    'ref: 845b887af902b19c',
    'ledger age: 1h',
    'witness age: 1h',
    'alarms carried: 0',
    'observed: 2024-01-06T00:00:00.000Z',
  ].join('\n'));
});

test('an absent alarms field is counted as zero', () => {
  const r = issueBody({ state: 'ok', ledgerTip: 'tip6', ledgerAgeH: 1, witnessAgeH: 1 }, '2024-01-07T00:00:00.000Z');
  assert.equal(r, [
    'state: ok',
    'ref: 798739cb83dd6d00',
    'ledger age: 1h',
    'witness age: 1h',
    'alarms carried: 0',
    'observed: 2024-01-07T00:00:00.000Z',
  ].join('\n'));
});

test('an empty ledger tip gives the same ref as a missing one and the observed value is passed through verbatim', () => {
  const r = issueBody({ state: 'warn', ledgerTip: '', alarms: Array.from({ length: 5 }, (_, i) => i) }, 'later');
  assert.equal(r, [
    'state: warn',
    'ref: 717497455c27c382',
    'ledger age: unknownh',
    'witness age: unknownh',
    'alarms carried: 5',
    'observed: later',
  ].join('\n'));
});
