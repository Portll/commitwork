// Computes the export health state from a receipts file (monitor/memory-export-health.mjs readExportHealth).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readExportHealth } from '../memory-export-health.mjs';

test('returns unreadable with null path when no directory is given', () => {
  const r = readExportHealth({ dir: null, readFile: () => '' });
  assert.deepEqual(r, { state: "unreadable", rank: 3, kind: "broken", meaning: "the receipts could not be read \u2014 a fault, and the export's outcome is UNKNOWN", counts: null, tallyDivergence: null, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "no report directory was given, so no receipts path could be built", path: null });
});

test('returns absent when the receipts file is missing', () => {
  const err = Object.assign(new Error('no file'), { code: 'ENOENT' });
  const r = readExportHealth({ dir: '/tmp/x', readFile: () => { throw err; } });
  assert.deepEqual(r, { state: "absent", rank: 2, kind: "behind", meaning: "no receipt was written beside this rollup \u2014 the lane exits 0 on every outcome, so absence of a receipt is silence, not a pass", counts: null, tallyDivergence: null, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "no receipt was written beside this rollup \u2014 the lane exits 0 on every outcome, so absence of a receipt is silence, not a pass", path: "/tmp/x/memory-layer-receipts.json" });
});

test('returns unreadable with code in reason when read fails with a non-ENOENT code', () => {
  const err = Object.assign(new Error('perm denied'), { code: 'EACCES' });
  const r = readExportHealth({ dir: '/tmp/x', readFile: () => { throw err; } });
  assert.deepEqual(r, { state: "unreadable", rank: 3, kind: "broken", meaning: "the receipts could not be read \u2014 a fault, and the export's outcome is UNKNOWN", counts: null, tallyDivergence: null, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "the receipts file could not be read (EACCES) \u2014 a fault, not an absence", path: "/tmp/x/memory-layer-receipts.json" });
});

test('returns unreadable with message in reason when read fails with no code', () => {
  const err = new Error('boom');
  const r = readExportHealth({ dir: '/tmp/x', readFile: () => { throw err; } });
  assert.deepEqual(r, { state: "unreadable", rank: 3, kind: "broken", meaning: "the receipts could not be read \u2014 a fault, and the export's outcome is UNKNOWN", counts: null, tallyDivergence: null, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "the receipts file could not be read (boom) \u2014 a fault, not an absence", path: "/tmp/x/memory-layer-receipts.json" });
});

test('returns unreadable with error fallback when read fails with a null error', () => {
  const r = readExportHealth({ dir: '/tmp/x', readFile: () => { throw null; } });
  assert.deepEqual(r, { state: "unreadable", rank: 3, kind: "broken", meaning: "the receipts could not be read \u2014 a fault, and the export's outcome is UNKNOWN", counts: null, tallyDivergence: null, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "the receipts file could not be read (error) \u2014 a fault, not an absence", path: "/tmp/x/memory-layer-receipts.json" });
});

test('returns unreadable when the receipts file is not valid JSON', () => {
  const r = readExportHealth({ dir: '/tmp/x', readFile: () => 'not json' });
  assert.deepEqual(r, { state: "unreadable", rank: 3, kind: "broken", meaning: "the receipts could not be read \u2014 a fault, and the export's outcome is UNKNOWN", counts: null, tallyDivergence: null, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "the receipts file is unparseable: Unexpected token 'o', \"not json\" is not valid JSON", path: "/tmp/x/memory-layer-receipts.json" });
});

test('returns absent when the receipts array is empty', () => {
  const payload = JSON.stringify({ receipts: [], tally: { total: 0, verified: 0, failed: 0, acceptedUnverified: 0, storedDivergent: 0, storedPreview: 0, notAttempted: 0, unknownState: 0 } });
  const r = readExportHealth({ dir: '/tmp/x', readFile: () => payload });
  assert.deepEqual(r, { state: "absent", rank: 2, kind: "behind", meaning: "no receipt was written beside this rollup \u2014 the lane exits 0 on every outcome, so absence of a receipt is silence, not a pass", counts: { verified: 0, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 0, truncated: 0, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 0 }, tallyDivergence: { state: "agrees", fields: [], note: null }, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "the receipts file exists and records ZERO write attempts \u2014 the export produced no evidence, which is not a clean run", path: "/tmp/x/memory-layer-receipts.json" });
});

test('returns verified when all receipts are verified and tally agrees', () => {
  const receipts = Array.from({ length: 3 }, (_, i) => ({ state: 'verified', reason: null }));
  const payload = JSON.stringify({ receipts, tally: { total: 3, verified: 3, failed: 0, acceptedUnverified: 0, storedDivergent: 0, storedPreview: 0, notAttempted: 0, unknownState: 0 }, generated: '2025-01-01T00:00:00Z', area: 'test', contractVersion: 1 });
  const r = readExportHealth({ dir: '/tmp/x', since: '2024-12-31T00:00:00Z', readFile: () => payload });
  assert.deepEqual(r, { state: "verified", rank: 0, kind: "ok", meaning: "every record was read back and the hashes matched", counts: { verified: 3, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 0, truncated: 0, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 3 }, tallyDivergence: { state: "agrees", fields: [], note: null }, generated: "2025-01-01T00:00:00Z", area: "test", contractVersion: 1, failedReasons: [], unverifiedReasons: [], undated: false, reason: "all 3 record(s) read back and the hashes matched", path: "/tmp/x/memory-layer-receipts.json" });
});

test('returns stale when generated is before since', () => {
  const receipts = Array.from({ length: 2 }, (_, i) => ({ state: 'verified', reason: null }));
  const payload = JSON.stringify({ receipts, tally: { total: 2, verified: 2, failed: 0, acceptedUnverified: 0, storedDivergent: 0, storedPreview: 0, notAttempted: 0, unknownState: 0 }, generated: '2024-01-01T00:00:00Z', area: 'test', contractVersion: 1 });
  const r = readExportHealth({ dir: '/tmp/x', since: '2025-01-01T00:00:00Z', readFile: () => payload });
  assert.deepEqual(r, { state: "stale", rank: 2, kind: "behind", meaning: "the receipts here predate this slice, so this run of the export left no evidence of its own", counts: { verified: 2, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 0, truncated: 0, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 2 }, tallyDivergence: { state: "agrees", fields: [], note: null }, generated: "2024-01-01T00:00:00Z", area: "test", contractVersion: 1, failedReasons: [], unverifiedReasons: [], undated: false, reason: "the newest receipt here is stamped 2024-01-01T00:00:00Z, before this slice began (2025-01-01T00:00:00Z) \u2014 the export wrote nothing this run", path: "/tmp/x/memory-layer-receipts.json" });
});

test('returns failed when some receipts are failed', () => {
  const receipts = [
    { state: 'verified', reason: null },
    { state: 'failed', reason: 'hash mismatch' },
  ];
  const payload = JSON.stringify({ receipts, tally: { total: 2, verified: 1, failed: 1, acceptedUnverified: 0, storedDivergent: 0, storedPreview: 0, notAttempted: 0, unknownState: 0 }, generated: '2025-01-01T00:00:00Z', area: 'test', contractVersion: 1 });
  const r = readExportHealth({ dir: '/tmp/x', since: '2024-12-31T00:00:00Z', readFile: () => payload });
  assert.deepEqual(r, { state: "failed", rank: 3, kind: "broken", meaning: "at least one record was NOT written, or what is stored is not what was sent", counts: { verified: 1, acceptedUnverified: 0, failed: 1, notAttempted: 0, unknownState: 0, truncated: 0, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 2 }, tallyDivergence: { state: "agrees", fields: [], note: null }, generated: "2025-01-01T00:00:00Z", area: "test", contractVersion: 1, failedReasons: [{ reason: "hash mismatch", count: 1 }], unverifiedReasons: [], undated: false, reason: "1 of 2 record(s) were NOT written", path: "/tmp/x/memory-layer-receipts.json" });
});
