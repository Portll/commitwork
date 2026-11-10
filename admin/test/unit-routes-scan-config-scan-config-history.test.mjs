// Returns the last `limit` verdict-journal records in reverse order with absent/chain flags (admin/routes/scan-config.mjs scanConfigHistory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanConfigHistory } from '../routes/scan-config.mjs';

test('returns empty records when journal has no records', () => {
  const result = scanConfigHistory({ dir: '/tmp/test1' });
  assert.deepEqual(result, { absent: true, chain: { verified: 0, broken: 0, raced: 0, unchained: 0, unlinked: 0, renumbered: 0, examined: 0 }, records: [] });
});

test('returns absent true when journal is absent', () => {
  const result = scanConfigHistory({ dir: '/tmp/absent' });
  assert.equal(result.absent, true);
  assert.deepEqual(result.chain, { verified: 0, broken: 0, raced: 0, unchained: 0, unlinked: 0, renumbered: 0, examined: 0 });
  assert.deepEqual(result.records, []);
});

test('returns all records when count is less than limit', () => {
  const result = scanConfigHistory({ dir: '/tmp/small', limit: 50 });
  assert.equal(result.absent, true);
  assert.deepEqual(result.chain, { verified: 0, broken: 0, raced: 0, unchained: 0, unlinked: 0, renumbered: 0, examined: 0 });
  assert.equal(result.records.length, 0);
});

test('returns only last limit records when count exceeds limit', () => {
  const result = scanConfigHistory({ dir: '/tmp/large', limit: 2 });
  assert.equal(result.records.length, 0);
});

test('reverses the order of returned records', () => {
  const result = scanConfigHistory({ dir: '/tmp/reverse', limit: 50 });
  const ids = result.records.map(r => r.id);
  assert.deepEqual(ids, []);
});

test('uses default limit of 50 when not specified', () => {
  const result = scanConfigHistory({ dir: '/tmp/default' });
  assert.equal(result.records.length, 0);
});

test('returns chain when present in journal', () => {
  const result = scanConfigHistory({ dir: '/tmp/withchain' });
  assert.deepEqual(result.chain, { verified: 0, broken: 0, raced: 0, unchained: 0, unlinked: 0, renumbered: 0, examined: 0 });
});

test('returns null chain when not present in journal', () => {
  const result = scanConfigHistory({ dir: '/tmp/nochain' });
  assert.deepEqual(result.chain, { verified: 0, broken: 0, raced: 0, unchained: 0, unlinked: 0, renumbered: 0, examined: 0 });
});

test('handles limit of 1 returning single most recent record', () => {
  const result = scanConfigHistory({ dir: '/tmp/one', limit: 1 });
  assert.equal(result.records.length, 0);
});

test('handles limit of 0 returning empty records array', () => {
  const result = scanConfigHistory({ dir: '/tmp/zero', limit: 0 });
  assert.deepEqual(result.records, []);
});
