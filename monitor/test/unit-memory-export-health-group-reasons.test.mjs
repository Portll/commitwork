// Groups receipt reasons by normalized key and returns the most frequent (monitor/memory-export-health.mjs groupReasons).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupReasons } from '../memory-export-health.mjs';

test('returns an empty array when no receipts match the requested states', () => {
  assert.deepEqual(groupReasons([{ state: 'verified' }], { states: ['failed'] }), []);
});

test('returns an empty array when receipts are null or undefined', () => {
  assert.deepEqual(groupReasons([null, undefined], { states: ['failed'] }), []);
});

test('normalizes hex identifiers and numeric offsets into placeholders', () => {
  const receipts = [
    { state: 'failed', reason: 'hash 0123456789abcdef mismatch at offset 12345' },
    { state: 'failed', reason: 'hash aabbccddeeff0011 mismatch at offset 67890' },
  ];
  assert.deepEqual(groupReasons(receipts, { states: ['failed'] }), [{ reason: "hash <hex> mismatch at offset <n>", count: 2 }]);
});

test('uses the default reason message when the reason field is missing', () => {
  const receipts = [
    { state: 'failed' },
    { state: 'failed', reason: null },
    { state: 'failed', reason: '' },
  ];
  assert.deepEqual(groupReasons(receipts, { states: ['failed'] }), [{ reason: "no reason recorded \u2014 the contract requires one, and its absence is itself the finding", count: 3 }]);
});

test('truncates the normalized reason to 160 characters', () => {
  const longReason = 'x'.repeat(200);
  const receipts = [{ state: 'failed', reason: longReason }];
  assert.deepEqual(groupReasons(receipts, { states: ['failed'] }), [{ reason: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", count: 1 }]);
});

test('truncates the normalized reason at exactly 160 characters', () => {
  const exactReason = 'x'.repeat(160);
  const receipts = [{ state: 'failed', reason: exactReason }];
  assert.deepEqual(groupReasons(receipts, { states: ['failed'] }), [{ reason: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", count: 1 }]);
});

test('caps the result at the requested number of entries', () => {
  const receipts = Array.from({ length: 10 }, (_, i) => ({ state: 'failed', reason: `reason ${i}` }));
  assert.deepEqual(groupReasons(receipts, { states: ['failed'], cap: 3 }), [{ reason: "reason <n>", count: 10 }]);
});

test('sorts by count descending and then by reason ascending', () => {
  const receipts = [
    { state: 'failed', reason: 'beta' },
    { state: 'failed', reason: 'alpha' },
    { state: 'failed', reason: 'alpha' },
    { state: 'failed', reason: 'beta' },
    { state: 'failed', reason: 'beta' },
  ];
  assert.deepEqual(groupReasons(receipts, { states: ['failed'] }), [{ reason: "beta", count: 3 }, { reason: "alpha", count: 2 }]);
});

test('sorts equal counts by reason ascending', () => {
  const receipts = [
    { state: 'failed', reason: 'zeta' },
    { state: 'failed', reason: 'alpha' },
  ];
  assert.deepEqual(groupReasons(receipts, { states: ['failed'] }), [{ reason: "alpha", count: 1 }, { reason: "zeta", count: 1 }]);
});

test('sorts equal counts by reason descending when the comparator is inverted', () => {
  const receipts = [
    { state: 'failed', reason: 'alpha' },
    { state: 'failed', reason: 'zeta' },
  ];
  assert.deepEqual(groupReasons(receipts, { states: ['failed'] }), [{ reason: "alpha", count: 1 }, { reason: "zeta", count: 1 }]);
});
