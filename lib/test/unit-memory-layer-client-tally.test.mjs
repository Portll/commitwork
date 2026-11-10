// Tallies receipt states, stored forms, and update flags into a summary object. (lib/memory-layer-client.mjs tally).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally } from '../memory-layer-client.mjs';

test('counts a single verified receipt with full storage and no update', () => {
  const r = { state: 'verified', truncated: false, storedForm: 'full', was_update: null };
  const t = tally([r]);
  assert.deepEqual(t, { verified: 1, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 0, truncated: 0, inserted: 0, updated: 0, storedFull: 1, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 1 });
});

test('counts a single accepted-unverified receipt with preview storage and an insert', () => {
  const r = { state: 'accepted-unverified', truncated: true, storedForm: 'preview', was_update: false };
  const t = tally([r]);
  assert.deepEqual(t, { verified: 0, acceptedUnverified: 1, failed: 0, notAttempted: 0, unknownState: 0, truncated: 1, inserted: 1, updated: 0, storedFull: 0, storedPreview: 1, storedDivergent: 0, storedUnknown: 0, total: 1 });
});

test('counts a single failed receipt with divergent storage and an update', () => {
  const r = { state: 'failed', truncated: false, storedForm: 'divergent', was_update: true };
  const t = tally([r]);
  assert.deepEqual(t, { verified: 0, acceptedUnverified: 0, failed: 1, notAttempted: 0, unknownState: 0, truncated: 0, inserted: 0, updated: 1, storedFull: 0, storedPreview: 0, storedDivergent: 1, storedUnknown: 0, total: 1 });
});

test('counts a single dry-run receipt with unknown storage and no update flag', () => {
  const r = { state: 'dry-run', truncated: true, storedForm: 'unknown', was_update: null };
  const t = tally([r]);
  assert.deepEqual(t, { verified: 0, acceptedUnverified: 0, failed: 0, notAttempted: 1, unknownState: 0, truncated: 1, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 1, total: 1 });
});

test('counts an unrecognized state as unknownState', () => {
  const r = { state: 'mystery', truncated: false, storedForm: 'full', was_update: false };
  const t = tally([r]);
  assert.deepEqual(t, { verified: 0, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 1, truncated: 0, inserted: 1, updated: 0, storedFull: 1, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 1 });
});

test('aggregates multiple receipts across all state and storage branches', () => {
  const receipts = [
    { state: 'verified', truncated: false, storedForm: 'full', was_update: null },
    { state: 'accepted-unverified', truncated: true, storedForm: 'preview', was_update: false },
    { state: 'failed', truncated: false, storedForm: 'divergent', was_update: true },
    { state: 'dry-run', truncated: true, storedForm: 'unknown', was_update: null },
    { state: 'weird', truncated: false, storedForm: 'full', was_update: false },
  ];
  const t = tally(receipts);
  assert.deepEqual(t, { verified: 1, acceptedUnverified: 1, failed: 1, notAttempted: 1, unknownState: 1, truncated: 2, inserted: 2, updated: 1, storedFull: 2, storedPreview: 1, storedDivergent: 1, storedUnknown: 1, total: 5 });
});

test('returns zeroed counters for an empty receipt list', () => {
  const t = tally([]);
  assert.deepEqual(t, { verified: 0, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 0, truncated: 0, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 0 });
});

test('counts a receipt with no storedForm and no was_update', () => {
  const r = { state: 'verified', truncated: false };
  const t = tally([r]);
  assert.deepEqual(t, { verified: 1, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 0, truncated: 0, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 1 });
});
