// Normalizes adjudication ledger read results into records and warnings (bin/rater-accuracy.mjs readLedger).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLedger } from '../rater-accuracy.mjs';

test('returns fatal error when read is null', () => {
  const result = readLedger(null);
  assert.deepEqual(result, { fatal: 'ledger read returned nothing' });
});

test('returns fatal error when read is undefined', () => {
  const result = readLedger(undefined);
  assert.deepEqual(result, { fatal: 'ledger read returned nothing' });
});

test('returns fatal error when read is not an object', () => {
  const result = readLedger('string');
  assert.deepEqual(result, { fatal: 'ledger read returned nothing' });
});

test('returns fatal error when ledger is absent', () => {
  const result = readLedger({ absent: true, records: [] });
  assert.deepEqual(result, { fatal: 'no adjudication ledger \u2014 never ran is not zero raters' });
});

test('returns fatal error when records is not an array', () => {
  const result = readLedger({ records: 'not-an-array' });
  assert.deepEqual(result, { fatal: 'ledger shape unrecognised (no records[]; keys: records)' });
});

test('returns records and empty warnings when ledger is clean', () => {
  const records = [{ id: 1 }, { id: 2 }];
  const result = readLedger({ records, chain: {} });
  assert.deepEqual(result, { records, warnings: [] });
});

test('includes torn warning when torn is truthy', () => {
  const records = [{ id: 1 }];
  const result = readLedger({ records, torn: 3, chain: {} });
  assert.deepEqual(result, { records, warnings: ['3 torn line(s) \u2014 the ledger was read PARTIALLY'] });
});

test('includes broken chain warning when chain.broken is truthy', () => {
  const records = [{ id: 1 }];
  const result = readLedger({ records, chain: { broken: 2 } });
  assert.deepEqual(result, { records, warnings: ['2 record(s) off the hash chain'] });
});

test('includes raced chain warning when chain.raced is truthy', () => {
  const records = [{ id: 1 }];
  const result = readLedger({ records, chain: { raced: 1 } });
  assert.deepEqual(result, { records, warnings: ['1 raced record(s)'] });
});

test('includes all warnings when torn, broken, and raced are all present', () => {
  const records = [{ id: 1 }];
  const result = readLedger({ records, torn: 2, chain: { broken: 3, raced: 4 } });
  assert.deepEqual(result, {
    records,
    warnings: [
      '2 torn line(s) \u2014 the ledger was read PARTIALLY',
      '3 record(s) off the hash chain',
      '4 raced record(s)',
    ],
  });
});
