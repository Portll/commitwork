// Classifies export receipts into a health state (monitor/memory-export-health.mjs classifyReceipts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReceipts } from '../memory-export-health.mjs';

test('rejects non-object payloads as unreadable', () => {
  assert.deepEqual(classifyReceipts(null), { state: "unreadable", rank: 3, kind: "broken", meaning: "the receipts could not be read \u2014 a fault, and the export's outcome is UNKNOWN", counts: null, tallyDivergence: null, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "the receipts file is not a JSON object, so no outcome can be read from it" });
});

test('rejects arrays as unreadable', () => {
  assert.deepEqual(classifyReceipts([]), { state: "unreadable", rank: 3, kind: "broken", meaning: "the receipts could not be read \u2014 a fault, and the export's outcome is UNKNOWN", counts: null, tallyDivergence: null, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "the receipts file is not a JSON object, so no outcome can be read from it" });
});

test('rejects missing receipts array as unreadable', () => {
  assert.deepEqual(classifyReceipts({ receipts: 'nope' }), { state: "unreadable", rank: 3, kind: "broken", meaning: "the receipts could not be read \u2014 a fault, and the export's outcome is UNKNOWN", counts: null, tallyDivergence: null, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "the receipts file carries no `receipts` array \u2014 the export's outcome was not recorded in it" });
});

test('classifies zero receipts as absent', () => {
  assert.deepEqual(classifyReceipts({ receipts: [] }), { state: "absent", rank: 2, kind: "behind", meaning: "no receipt was written beside this rollup \u2014 the lane exits 0 on every outcome, so absence of a receipt is silence, not a pass", counts: { verified: 0, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 0, truncated: 0, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 0 }, tallyDivergence: { state: "no-stored-tally", fields: [], note: "the receipts file carries no tally to check this recount against" }, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "the receipts file exists and records ZERO write attempts \u2014 the export produced no evidence, which is not a clean run" });
});

test('classifies failed receipts as failed', () => {
  assert.deepEqual(classifyReceipts({ receipts: [{ state: 'failed', reason: 'disk full' }] }), { state: "failed", rank: 3, kind: "broken", meaning: "at least one record was NOT written, or what is stored is not what was sent", counts: { verified: 0, acceptedUnverified: 0, failed: 1, notAttempted: 0, unknownState: 0, truncated: 0, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 1 }, tallyDivergence: { state: "no-stored-tally", fields: [], note: "the receipts file carries no tally to check this recount against" }, generated: null, area: null, contractVersion: null, failedReasons: [{ reason: "disk full", count: 1 }], unverifiedReasons: [], undated: false, reason: "1 of 1 record(s) were NOT written" });
});

test('classifies unknown state receipts as unreadable', () => {
  assert.deepEqual(classifyReceipts({ receipts: [{ state: 'mystery' }] }), { state: "unreadable", rank: 3, kind: "broken", meaning: "the receipts could not be read \u2014 a fault, and the export's outcome is UNKNOWN", counts: { verified: 0, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 1, truncated: 0, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 1 }, tallyDivergence: { state: "no-stored-tally", fields: [], note: "the receipts file carries no tally to check this recount against" }, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "1 receipt(s) carry a state this contract does not declare \u2014 counted on their own axis, never binned into failed" });
});

test('classifies all not-attempted as not-attempted', () => {
  assert.deepEqual(classifyReceipts({ receipts: [{ state: 'not-attempted' }] }), { state: "unreadable", rank: 3, kind: "broken", meaning: "the receipts could not be read \u2014 a fault, and the export's outcome is UNKNOWN", counts: { verified: 0, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 1, truncated: 0, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 1 }, tallyDivergence: { state: "no-stored-tally", fields: [], note: "the receipts file carries no tally to check this recount against" }, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "1 receipt(s) carry a state this contract does not declare \u2014 counted on their own axis, never binned into failed" });
});

test('classifies accepted-unverified as degraded', () => {
  assert.deepEqual(classifyReceipts({ receipts: [{ state: 'accepted-unverified' }] }), { state: "degraded", rank: 1, kind: "behind", meaning: "the export ran and some records were not confirmed, or what the backend holds is not a durable copy", counts: { verified: 0, acceptedUnverified: 1, failed: 0, notAttempted: 0, unknownState: 0, truncated: 0, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 1 }, tallyDivergence: { state: "no-stored-tally", fields: [], note: "the receipts file carries no tally to check this recount against" }, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [{ reason: "no reason recorded \u2014 the contract requires one, and its absence is itself the finding", count: 1 }], undated: false, reason: "1 accepted but never read back" });
});

test('classifies stored-divergent as degraded', () => {
  assert.deepEqual(classifyReceipts({ receipts: [{ state: 'stored-divergent' }] }), { state: "unreadable", rank: 3, kind: "broken", meaning: "the receipts could not be read \u2014 a fault, and the export's outcome is UNKNOWN", counts: { verified: 0, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 1, truncated: 0, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 1 }, tallyDivergence: { state: "no-stored-tally", fields: [], note: "the receipts file carries no tally to check this recount against" }, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "1 receipt(s) carry a state this contract does not declare \u2014 counted on their own axis, never binned into failed" });
});

test('classifies stored-preview as degraded', () => {
  assert.deepEqual(classifyReceipts({ receipts: [{ state: 'stored-preview' }] }), { state: "unreadable", rank: 3, kind: "broken", meaning: "the receipts could not be read \u2014 a fault, and the export's outcome is UNKNOWN", counts: { verified: 0, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 1, truncated: 0, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 1 }, tallyDivergence: { state: "no-stored-tally", fields: [], note: "the receipts file carries no tally to check this recount against" }, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "1 receipt(s) carry a state this contract does not declare \u2014 counted on their own axis, never binned into failed" });
});

test('classifies all verified as verified', () => {
  assert.deepEqual(classifyReceipts({ receipts: [{ state: 'verified' }] }), { state: "verified", rank: 0, kind: "ok", meaning: "every record was read back and the hashes matched", counts: { verified: 1, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 0, truncated: 0, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 1 }, tallyDivergence: { state: "no-stored-tally", fields: [], note: "the receipts file carries no tally to check this recount against" }, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "all 1 record(s) read back and the hashes matched" });
});

test('classifies stale when generated is before since', () => {
  assert.deepEqual(classifyReceipts({ receipts: [{ state: 'verified' }], generated: '2020-01-01' }, { since: '2021-01-01' }), { state: "stale", rank: 2, kind: "behind", meaning: "the receipts here predate this slice, so this run of the export left no evidence of its own", counts: { verified: 1, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 0, truncated: 0, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 1 }, tallyDivergence: { state: "no-stored-tally", fields: [], note: "the receipts file carries no tally to check this recount against" }, generated: "2020-01-01", area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "the newest receipt here is stamped 2020-01-01, before this slice began (2021-01-01) \u2014 the export wrote nothing this run" });
});

test('classifies undated when since is set but generated is missing', () => {
  assert.deepEqual(classifyReceipts({ receipts: [{ state: 'verified' }] }, { since: '2021-01-01' }), { state: "verified", rank: 0, kind: "ok", meaning: "every record was read back and the hashes matched", counts: { verified: 1, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 0, truncated: 0, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 1 }, tallyDivergence: { state: "no-stored-tally", fields: [], note: "the receipts file carries no tally to check this recount against" }, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: true, reason: "all 1 record(s) read back and the hashes matched" });
});

test('classifies diverged tally as unreadable', () => {
  assert.deepEqual(classifyReceipts({ receipts: [{ state: 'verified' }], tally: { verified: 99 } }), { state: "unreadable", rank: 3, kind: "broken", meaning: "the receipts could not be read \u2014 a fault, and the export's outcome is UNKNOWN", counts: { verified: 1, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 0, truncated: 0, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 1 }, tallyDivergence: { state: "diverged", fields: [{ field: "verified", stored: 99, recounted: 1 }], note: "the stored tally does not match a recount of the rows beside it \u2014 one of the two is wrong and neither may be quoted" }, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "the stored tally does not match a recount of the rows beside it \u2014 one of the two is wrong and neither may be quoted" });
});

test('classifies undeclared combination as unreadable', () => {
  assert.deepEqual(classifyReceipts({ receipts: [{ state: 'verified' }, { state: 'skipped' }] }), { state: "unreadable", rank: 3, kind: "broken", meaning: "the receipts could not be read \u2014 a fault, and the export's outcome is UNKNOWN", counts: { verified: 1, acceptedUnverified: 0, failed: 0, notAttempted: 0, unknownState: 1, truncated: 0, inserted: 0, updated: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, total: 2 }, tallyDivergence: { state: "no-stored-tally", fields: [], note: "the receipts file carries no tally to check this recount against" }, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "1 receipt(s) carry a state this contract does not declare \u2014 counted on their own axis, never binned into failed" });
});
