// Tri-state overwatch reachability from tool-filed ledger rows and store mtime (bin/gate-spine-core.mjs overwatchReachability).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overwatchReachability } from '../gate-spine-core.mjs';

const at = (ms) => new Date(ms).toISOString();
const call = (o) => overwatchReachability({ spineRows: [{ at: at(1000) }], dbMtimeMs: 0, now: 2000, outageMs: 100, ...o });

test('a zero, negative or non-finite outage window or a non-finite clock yields unknown', () => {
  assert.equal(call({ spineRows: [{ at: at(5000) }], now: 1000, outageMs: 0 }), 'unknown');
  assert.equal(call({ spineRows: [{ at: at(5000) }], now: 1000, outageMs: -1 }), 'unknown');
  assert.equal(call({ outageMs: NaN }), 'unknown');
  assert.equal(call({ outageMs: Infinity }), 'unknown');
  assert.equal(call({ now: NaN }), 'unknown');
  assert.equal(call({ now: Infinity }), 'unknown');
  assert.equal(call({}), false);
});

test('an outage window of one millisecond accepts a filing made exactly at now', () => {
  assert.equal(call({ spineRows: [{ at: at(1000) }], now: 1000, outageMs: 1, dbMtimeMs: undefined }), true);
});

test('a missing, non-array or empty ledger yields unknown', () => {
  assert.equal(call({ spineRows: undefined }), 'unknown');
  assert.equal(call({ spineRows: null }), 'unknown');
  assert.equal(call({ spineRows: 'abc' }), 'unknown');
  assert.equal(call({ spineRows: { length: 0 } }), 'unknown');
  assert.equal(call({ spineRows: [] }), 'unknown');
});

test('rows filed by a bypass route do not witness the tool', () => {
  assert.equal(call({ spineRows: [{ at: at(1990), via: 'spine/db.mjs direct' }] }), 'unknown');
  assert.equal(call({ spineRows: [{ at: at(1950), via: 'direct' }, { at: at(500) }] }), false);
  assert.equal(call({ spineRows: [{ at: at(1950), via: '' }] }), true);
});

test('rows without a parseable string timestamp yield unknown', () => {
  const spineRows = [null, {}, { at: 1990 }, { at: 'not a date' }];
  assert.equal(call({ spineRows, dbMtimeMs: 2000 }), 'unknown');
});

test('the newest tool filing inside the window proves reachability without consulting the store', () => {
  const spineRows = [{ at: at(1000) }, { at: at(1901) }, { at: at(1500) }];
  assert.equal(call({ spineRows, dbMtimeMs: undefined }), true);
});

test('a filing exactly one window old is stale and an unreadable, absent or invalid store mtime yields unknown', () => {
  const spineRows = [{ at: at(1900) }];
  assert.equal(call({ spineRows, dbMtimeMs: undefined }), 'unknown');
  assert.equal(call({ spineRows, dbMtimeMs: null }), 'unknown');
  assert.equal(call({ spineRows, dbMtimeMs: NaN }), 'unknown');
  assert.equal(call({ spineRows, dbMtimeMs: Infinity }), 'unknown');
});

test('a store modified less than one window ago proves reachability when the ledger is stale', () => {
  assert.equal(call({ spineRows: [{ at: at(0) }], dbMtimeMs: 1901 }), true);
  assert.equal(call({ spineRows: [{ at: at(1900) }], dbMtimeMs: 2000 }), true);
});

test('a store modified exactly one window ago is stale so both witnesses report an outage', () => {
  assert.equal(call({ spineRows: [{ at: at(0) }], dbMtimeMs: 1900 }), false);
  assert.equal(call({ spineRows: [{ at: at(1900) }], dbMtimeMs: 0 }), false);
});
