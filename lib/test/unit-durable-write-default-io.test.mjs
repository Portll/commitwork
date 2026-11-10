// The table of node:fs sync functions used for durable writes (lib/durable-write.mjs defaultIO).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultIO } from '../durable-write.mjs';

const EXPECTED_KEYS = [
  'openSync',
  'writeSync',
  'fsyncSync',
  'closeSync',
  'renameSync',
  'unlinkSync',
  'mkdirSync',
  'statSync',
  'statfsSync',
  'readFileSync',
  'fstatSync',
  'fchmodSync',
  'appendFileSync',
];

test('Returns exactly the thirteen fs method keys in declaration order.', () => {
  const r = defaultIO();
  assert.deepEqual(Object.keys(r), EXPECTED_KEYS);
});

test('Each value is the fs function whose name matches its key.', () => {
  const r = defaultIO();
  const names = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.name]));
  const expected = Object.fromEntries(EXPECTED_KEYS.map((k) => [k, k]));
  assert.deepEqual(names, expected);
});

test('Two calls return distinct objects with the same keys.', () => {
  const a = defaultIO();
  const b = defaultIO();
  assert.notEqual(a, b);
  assert.deepEqual(Object.keys(b), Object.keys(a));
});

test('Two calls share the same function references for every key.', () => {
  const a = defaultIO();
  const b = defaultIO();
  const same = EXPECTED_KEYS.map((k) => a[k] === b[k]);
  assert.deepEqual(same, EXPECTED_KEYS.map(() => true));
});

test('Overwriting a property on one result does not affect the next call.', () => {
  const a = defaultIO();
  a.openSync = null;
  const b = defaultIO();
  assert.equal(a.openSync, null);
  assert.equal(b.openSync.name, 'openSync');
});

test('The stat and statfs entries are different functions.', () => {
  const r = defaultIO();
  assert.notEqual(r.statSync, r.statfsSync);
  assert.equal(r.statSync.name, 'statSync');
  assert.equal(r.statfsSync.name, 'statfsSync');
});

test('The fstat and fchmod entries are named for their own functions.', () => {
  const r = defaultIO();
  assert.equal(r.fstatSync.name, 'fstatSync');
  assert.equal(r.fchmodSync.name, 'fchmodSync');
  assert.notEqual(r.fstatSync, r.statSync);
});
