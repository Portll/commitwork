// Maps a ledger row to its access kind (bin/lib/touch-ledger-core.mjs accessOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessOf } from '../lib/touch-ledger-core.mjs';

test('returns the access kind when it is already a valid kind', () => {
  assert.equal(accessOf({ access: 'read' }), "read");
});

test('returns write when the payload type is write', () => {
  assert.equal(accessOf({ t: 'write' }), "write");
});

test('returns write when the payload type is edit', () => {
  assert.equal(accessOf({ t: 'edit' }), "write");
});

test('returns write when the via field is commit', () => {
  assert.equal(accessOf({ via: 'commit' }), "write");
});

test('returns write when the via field is shell', () => {
  assert.equal(accessOf({ via: 'shell' }), "write");
});

test('returns exec when the x flag is truthy', () => {
  assert.equal(accessOf({ x: true }), "exec");
});

test('returns exec when the via field is exec', () => {
  assert.equal(accessOf({ via: 'exec' }), "exec");
});

test('returns undetermined when no branch matches', () => {
  assert.equal(accessOf({}), "undetermined");
});

test('returns undetermined when the row is undefined', () => {
  assert.equal(accessOf(), "undetermined");
});

test('returns write when the payload type is write and via is exec', () => {
  assert.equal(accessOf({ t: 'write', via: 'exec' }), "write");
});
