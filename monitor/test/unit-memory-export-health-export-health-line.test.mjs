// Formats a one-line human-readable summary of a memory export health record (monitor/memory-export-health.mjs exportHealthLine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportHealthLine } from '../memory-export-health.mjs';

test('renders verified state with full counts and no failed reasons', () => {
  const h = {
    state: 'verified',
    counts: { total: 10, verified: 10, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 0 },
    failedReasons: [],
    reason: null,
  };
  assert.equal(exportHealthLine(h), "memory export VERIFIED \u2014 10 record(s): 10 verified, 0 accepted-unverified, 0 failed");
});

test('renders failed state with notAttempted and unknownState counts plus a failed reason', () => {
  const h = {
    state: 'failed',
    counts: { total: 5, verified: 2, acceptedUnverified: 1, failed: 2, notAttempted: 1, unknownState: 1 },
    failedReasons: [{ reason: 'hash mismatch', count: 2 }],
    reason: 'backend rejected batch',
  };
  assert.equal(exportHealthLine(h), "memory export FAILED \u2014 5 record(s): 2 verified, 1 accepted-unverified, 2 failed, 1 dry-run, 1 undeclared-state \u00b7 backend rejected batch \u00b7 loudest: hash mismatch (x2)");
});

test('renders degraded state with zero counts and a reason but no failed reasons', () => {
  const h = {
    state: 'degraded',
    counts: { total: 0, verified: 0, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 0 },
    failedReasons: [],
    reason: 'partial write',
  };
  assert.equal(exportHealthLine(h), "memory export DEGRADED \u2014 0 record(s): 0 verified, 0 accepted-unverified, 0 failed \u00b7 partial write");
});

test('renders absent state with null counts and no reason or failed reasons', () => {
  const h = {
    state: 'absent',
    counts: null,
    failedReasons: [],
    reason: null,
  };
  assert.equal(exportHealthLine(h), "memory export ABSENT \u2014 no counts");
});

test('renders skipped state with counts and a failed reason entry', () => {
  const h = {
    state: 'skipped',
    counts: { total: 3, verified: 0, acceptedUnverified: 0, failed: 3, notAttempted: 0, unknownState: 0 },
    failedReasons: [{ reason: 'switch off', count: 3 }],
    reason: null,
  };
  assert.equal(exportHealthLine(h), "memory export SKIPPED \u2014 3 record(s): 0 verified, 0 accepted-unverified, 3 failed \u00b7 loudest: switch off (x3)");
});

test('renders stale state with counts and a reason but empty failed reasons', () => {
  const h = {
    state: 'stale',
    counts: { total: 7, verified: 5, acceptedUnverified: 1, failed: 1, notAttempted: 0, unknownState: 0 },
    failedReasons: [],
    reason: 'receipts predate slice',
  };
  assert.equal(exportHealthLine(h), "memory export STALE \u2014 7 record(s): 5 verified, 1 accepted-unverified, 1 failed \u00b7 receipts predate slice");
});

test('renders unreadable state with null counts and a failed reason', () => {
  const h = {
    state: 'unreadable',
    counts: null,
    failedReasons: [{ reason: 'parse error', count: 1 }],
    reason: 'receipts unreadable',
  };
  assert.equal(exportHealthLine(h), "memory export UNREADABLE \u2014 no counts \u00b7 receipts unreadable \u00b7 loudest: parse error (x1)");
});

test('renders not-attempted state with counts and no reason or failed reasons', () => {
  const h = {
    state: 'not-attempted',
    counts: { total: 4, verified: 0, acceptedUnverified: 0, failed: 0, notAttempted: 4, unknownState: 0 },
    failedReasons: [],
    reason: null,
  };
  assert.equal(exportHealthLine(h), "memory export NOT-ATTEMPTED \u2014 4 record(s): 0 verified, 0 accepted-unverified, 0 failed, 4 dry-run");
});
