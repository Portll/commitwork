// Computes the combined local-store and export observation state with the louder tone (admin/lib/memory-view.mjs observationState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observationState } from '../lib/memory-view.mjs';

const okSurvey = (exports) => ({ state: 'ok', rollups: 3, withReceipts: 2, exports });
const badSurvey = (reason) => ({ state: 'unreadable', reason });

test('returns unknown grey when survey state is not ok', () => {
  const store = { state: 'ok', path: '/db', receipts: 1, records: 5 };
  const survey = badSurvey('boom');
  const r = observationState(store, survey);
  assert.equal(r.tone, "grey");
  assert.equal(r.exports.state, 'unknown');
  assert.equal(r.exports.tone, 'grey');
  assert.equal(r.exports.headline, "the export's outcome is UNKNOWN \u2014 the rollup population could not be read");
  assert.equal(r.exports.detail, 'Nothing here is a reading: boom.');
});

test('returns never-observed grey when areasCounted is zero', () => {
  const store = { state: 'ok', path: '/db', receipts: 1, records: 5 };
  const survey = okSurvey({ areasCounted: 0, receipts: 0, failedReceipts: 0, unverifiedReceipts: 0, byState: { degraded: 0, unreadable: 0, absent: 0, stale: 0, verified: 0, 'not-attempted': 0, skipped: 0, failed: 0 } });
  const r = observationState(store, survey);
  assert.equal(r.exports.state, 'never-observed');
  assert.equal(r.exports.tone, 'grey');
  assert.equal(r.exports.headline, 'no report directory carries an export receipt \u2014 the export has never been observed here');
});

test('returns failed alarm when failedReceipts is positive', () => {
  const store = { state: 'ok', path: '/db', receipts: 1, records: 5 };
  const survey = okSurvey({ areasCounted: 2, receipts: 3, failedReceipts: 1, unverifiedReceipts: 0, byState: { degraded: 0, unreadable: 0, absent: 0, stale: 0, verified: 1, 'not-attempted': 0, skipped: 0, failed: 1 } });
  const r = observationState(store, survey);
  assert.equal(r.tone, 'alarm');
  assert.equal(r.exports.state, 'failed');
  assert.equal(r.exports.tone, 'alarm');
  assert.equal(r.exports.headline, '1 export write FAILED across 1 of 2 areas \u2014 those records are not in the backend');
  assert.equal(r.exports.detail, '3 receipts sit in memory-layer-receipts.json files on disk, so the lane is writing evidence; 1 of them record a write that did NOT happen and 0 more were accepted and never read back. A count of receipts is not a count of stored records.');
});

test('returns unreadable alarm when unreadable faults exist', () => {
  const store = { state: 'ok', path: '/db', receipts: 1, records: 5 };
  const survey = okSurvey({ areasCounted: 2, receipts: 2, failedReceipts: 0, unverifiedReceipts: 0, byState: { degraded: 0, unreadable: 1, absent: 0, stale: 0, verified: 1, 'not-attempted': 0, skipped: 0, failed: 0 } });
  const r = observationState(store, survey);
  assert.equal(r.tone, 'alarm');
  assert.equal(r.exports.state, 'unreadable');
  assert.equal(r.exports.tone, 'alarm');
  assert.equal(r.exports.headline, '1 of 2 areas have receipts this page could not read \u2014 their export outcome is UNKNOWN');
  assert.equal(r.exports.detail, 'A parse failure or a permission error is a fault, not an empty result. No claim about those areas is a reading.');
});

test('returns degraded warn when degraded areas exist', () => {
  const store = { state: 'ok', path: '/db', receipts: 1, records: 5 };
  const survey = okSurvey({ areasCounted: 2, receipts: 2, failedReceipts: 0, unverifiedReceipts: 1, byState: { degraded: 1, unreadable: 0, absent: 0, stale: 0, verified: 1, 'not-attempted': 0, skipped: 0, failed: 0 } });
  const r = observationState(store, survey);
  assert.equal(r.tone, 'warn');
  assert.equal(r.exports.state, 'degraded');
  assert.equal(r.exports.tone, 'warn');
  assert.equal(r.exports.headline, '1 of 2 areas report a degraded export \u2014 1 write accepted and never read back');
  assert.equal(r.exports.detail, 'No write failed outright. Accepted-unverified is neither a pass nor a failure and is counted on its own axis rather than folded into either.');
});

test('returns never-observed grey when all areas are unmeasured', () => {
  const store = { state: 'ok', path: '/db', receipts: 1, records: 5 };
  const survey = okSurvey({ areasCounted: 2, receipts: 0, failedReceipts: 0, unverifiedReceipts: 0, byState: { degraded: 0, unreadable: 0, absent: 1, stale: 1, verified: 0, 'not-attempted': 0, skipped: 0, failed: 0 } });
  const r = observationState(store, survey);
  assert.equal(r.tone, 'grey');
  assert.equal(r.exports.state, 'never-observed');
  assert.equal(r.exports.tone, 'grey');
  assert.equal(r.exports.headline, 'no export has been observed for any of the 2 areas on disk \u2014 1 wrote no receipt, 1 carry one older than their own rollup');
  assert.equal(r.exports.detail, 'The lane exits 0 on every outcome (monitor/export-overwatch.mjs), so absence of a memory-layer-receipts.json is silence rather than a pass. It is also not a finding: nothing here measured a failure.');
});

test('returns partly-observed grey when some areas are unmeasured', () => {
  const store = { state: 'ok', path: '/db', receipts: 1, records: 5 };
  const survey = okSurvey({ areasCounted: 3, receipts: 1, failedReceipts: 0, unverifiedReceipts: 0, byState: { degraded: 0, unreadable: 0, absent: 1, stale: 1, verified: 1, 'not-attempted': 0, skipped: 0, failed: 0 } });
  const r = observationState(store, survey);
  assert.equal(r.tone, 'grey');
  assert.equal(r.exports.state, 'partly-observed');
  assert.equal(r.exports.tone, 'grey');
  assert.equal(r.exports.headline, '1 of 3 areas report a clean export; the other 2 were not measured');
  assert.equal(r.exports.detail, '1 area(s) wrote no receipt and 1 carry one older than their own rollup. Those are unobserved, which is neither a pass nor a failure, and they are excluded from the clean count rather than added to it.');
});

test('returns verified ok when all exports are clean', () => {
  const store = { state: 'ok', path: '/db', receipts: 1, records: 5 };
  const survey = okSurvey({ areasCounted: 2, receipts: 2, failedReceipts: 0, unverifiedReceipts: 0, byState: { degraded: 0, unreadable: 0, absent: 0, stale: 0, verified: 1, 'not-attempted': 1, skipped: 0, failed: 0 } });
  const r = observationState(store, survey);
  assert.equal(r.tone, 'ok');
  assert.equal(r.exports.state, 'verified');
  assert.equal(r.exports.tone, 'ok');
  assert.equal(r.exports.headline, 'every export on disk reports a clean write \u2014 2 receipts across 2 areas, none failed');
  assert.equal(r.exports.detail, '1 area(s) fully verified, 1 dry-run, 0 switched off.');
});
