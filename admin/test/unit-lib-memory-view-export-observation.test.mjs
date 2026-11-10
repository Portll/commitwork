// Maps a survey of export receipts to a single observation object with state, tone, headline, and detail (admin/lib/memory-view.mjs exportObservation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportObservation } from '../lib/memory-view.mjs';

test('returns unknown when survey state is not ok', () => {
  const survey = { state: 'error', reason: 'disk full' };
  const result = exportObservation(survey);
  assert.deepEqual(result, {
    state: 'unknown',
    tone: 'grey',
    headline: "the export's outcome is UNKNOWN \u2014 the rollup population could not be read",
    detail: 'Nothing here is a reading: disk full.'
  });
});

test('returns unknown when exports is missing', () => {
  const survey = { state: 'ok' };
  const result = exportObservation(survey);
  assert.deepEqual(result, {
    state: 'unknown',
    tone: 'grey',
    headline: "the export's outcome is UNKNOWN \u2014 the rollup population could not be read",
    detail: 'Nothing here is a reading: no survey was supplied.'
  });
});

test('returns never-observed when areasCounted is zero', () => {
  const survey = {
    state: 'ok',
    exports: {
      areasCounted: 0,
      byState: { degraded: 0, unreadable: 0, absent: 0, stale: 0, verified: 0, 'not-attempted': 0, skipped: 0, failed: 0 },
      failedReceipts: 0,
      receipts: 0,
      unverifiedReceipts: 0
    }
  };
  const result = exportObservation(survey);
  assert.equal(result.state, 'never-observed');
  assert.equal(result.tone, 'grey');
  assert.equal(result.headline, 'no report directory carries an export receipt \u2014 the export has never been observed here');
  assert.equal(result.detail, 'The lane exits 0 on every outcome (monitor/export-overwatch.mjs), so with no memory-layer-receipts.json anywhere, exit-0-always is silent-failure-always.');
});

test('returns failed with alarm tone when failedReceipts is greater than zero', () => {
  const survey = {
    state: 'ok',
    exports: {
      areasCounted: 5,
      byState: { degraded: 0, unreadable: 0, absent: 0, stale: 0, verified: 3, 'not-attempted': 0, skipped: 0, failed: 2 },
      failedReceipts: 2,
      receipts: 5,
      unverifiedReceipts: 1
    }
  };
  const result = exportObservation(survey);
  assert.equal(result.state, 'failed');
  assert.equal(result.tone, 'alarm');
  assert.equal(result.headline, '2 export writes FAILED across 2 of 5 areas \u2014 those records are not in the backend');
  assert.equal(result.detail, '5 receipts sit in memory-layer-receipts.json files on disk, so the lane is writing evidence; 2 of them record a write that did NOT happen and 1 more were accepted and never read back. A count of receipts is not a count of stored records.');
});

test('returns unreadable with alarm tone when unreadable faults exist and no failed receipts', () => {
  const survey = {
    state: 'ok',
    exports: {
      areasCounted: 3,
      byState: { degraded: 0, unreadable: 1, absent: 0, stale: 0, verified: 2, 'not-attempted': 0, skipped: 0, failed: 0 },
      failedReceipts: 0,
      receipts: 3,
      unverifiedReceipts: 0
    }
  };
  const result = exportObservation(survey);
  assert.equal(result.state, 'unreadable');
  assert.equal(result.tone, 'alarm');
  assert.equal(result.headline, '1 of 3 areas have receipts this page could not read \u2014 their export outcome is UNKNOWN');
  assert.equal(result.detail, 'A parse failure or a permission error is a fault, not an empty result. No claim about those areas is a reading.');
});

test('returns degraded with warn tone when measured areas exist and no faults or failures', () => {
  const survey = {
    state: 'ok',
    exports: {
      areasCounted: 4,
      byState: { degraded: 2, unreadable: 0, absent: 1, stale: 1, verified: 0, 'not-attempted': 0, skipped: 0, failed: 0 },
      failedReceipts: 0,
      receipts: 2,
      unverifiedReceipts: 2
    }
  };
  const result = exportObservation(survey);
  assert.equal(result.state, 'degraded');
  assert.equal(result.tone, 'warn');
  assert.equal(result.headline, '2 of 4 areas report a degraded export \u2014 2 writes accepted and never read back');
  assert.equal(result.detail, 'No write failed outright. Accepted-unverified is neither a pass nor a failure and is counted on its own axis rather than folded into either. A further 2 area(s) have no current receipt at all and are unmeasured, not clean.');
});

test('returns degraded with warn tone when exactly one area is degraded', () => {
  const survey = {
    state: 'ok',
    exports: {
      areasCounted: 2,
      byState: { degraded: 1, unreadable: 0, absent: 0, stale: 0, verified: 1, 'not-attempted': 0, skipped: 0, failed: 0 },
      failedReceipts: 0,
      receipts: 2,
      unverifiedReceipts: 1
    }
  };
  const result = exportObservation(survey);
  assert.equal(result.state, 'degraded');
  assert.equal(result.tone, 'warn');
  assert.equal(result.headline, '1 of 2 areas report a degraded export \u2014 1 write accepted and never read back');
  assert.equal(result.detail, 'No write failed outright. Accepted-unverified is neither a pass nor a failure and is counted on its own axis rather than folded into either.');
});

test('returns never-observed when all areas are unmeasured and no measured or faulty areas', () => {
  const survey = {
    state: 'ok',
    exports: {
      areasCounted: 3,
      byState: { degraded: 0, unreadable: 0, absent: 2, stale: 1, verified: 0, 'not-attempted': 0, skipped: 0, failed: 0 },
      failedReceipts: 0,
      receipts: 0,
      unverifiedReceipts: 0
    }
  };
  const result = exportObservation(survey);
  assert.equal(result.state, 'never-observed');
  assert.equal(result.tone, 'grey');
  assert.equal(result.headline, 'no export has been observed for any of the 3 areas on disk \u2014 2 wrote no receipt, 1 carry one older than their own rollup');
  assert.equal(result.detail, 'The lane exits 0 on every outcome (monitor/export-overwatch.mjs), so absence of a memory-layer-receipts.json is silence rather than a pass. It is also not a finding: nothing here measured a failure.');
});

test('returns never-observed when exactly one area is unmeasured', () => {
  const survey = {
    state: 'ok',
    exports: {
      areasCounted: 1,
      byState: { degraded: 0, unreadable: 0, absent: 1, stale: 0, verified: 0, 'not-attempted': 0, skipped: 0, failed: 0 },
      failedReceipts: 0,
      receipts: 0,
      unverifiedReceipts: 0
    }
  };
  const result = exportObservation(survey);
  assert.equal(result.state, 'never-observed');
  assert.equal(result.tone, 'grey');
  assert.equal(result.headline, 'no export has been observed for any of the 1 area on disk \u2014 1 wrote no receipt, 0 carry one older than their own rollup');
  assert.equal(result.detail, 'The lane exits 0 on every outcome (monitor/export-overwatch.mjs), so absence of a memory-layer-receipts.json is silence rather than a pass. It is also not a finding: nothing here measured a failure.');
});

test('returns partly-observed with grey tone when some areas are unmeasured but not all', () => {
  const survey = {
    state: 'ok',
    exports: {
      areasCounted: 5,
      byState: { degraded: 0, unreadable: 0, absent: 2, stale: 1, verified: 2, 'not-attempted': 0, skipped: 0, failed: 0 },
      failedReceipts: 0,
      receipts: 2,
      unverifiedReceipts: 0
    }
  };
  const result = exportObservation(survey);
  assert.equal(result.state, 'partly-observed');
  assert.equal(result.tone, 'grey');
  assert.equal(result.headline, '2 of 5 areas report a clean export; the other 3 were not measured');
  assert.equal(result.detail, '2 area(s) wrote no receipt and 1 carry one older than their own rollup. Those are unobserved, which is neither a pass nor a failure, and they are excluded from the clean count rather than added to it.');
});

test('returns partly-observed with grey tone when exactly one area is unmeasured', () => {
  const survey = {
    state: 'ok',
    exports: {
      areasCounted: 2,
      byState: { degraded: 0, unreadable: 0, absent: 1, stale: 0, verified: 1, 'not-attempted': 0, skipped: 0, failed: 0 },
      failedReceipts: 0,
      receipts: 1,
      unverifiedReceipts: 0
    }
  };
  const result = exportObservation(survey);
  assert.equal(result.state, 'partly-observed');
  assert.equal(result.tone, 'grey');
  assert.equal(result.headline, '1 of 2 areas report a clean export; the other 1 were not measured');
  assert.equal(result.detail, '1 area(s) wrote no receipt and 0 carry one older than their own rollup. Those are unobserved, which is neither a pass nor a failure, and they are excluded from the clean count rather than added to it.');
});

test('returns verified with ok tone when all areas are clean and no unmeasured areas', () => {
  const survey = {
    state: 'ok',
    exports: {
      areasCounted: 3,
      byState: { degraded: 0, unreadable: 0, absent: 0, stale: 0, verified: 2, 'not-attempted': 1, skipped: 0, failed: 0 },
      failedReceipts: 0,
      receipts: 2,
      unverifiedReceipts: 0
    }
  };
  const result = exportObservation(survey);
  assert.equal(result.state, 'verified');
  assert.equal(result.tone, 'ok');
  assert.equal(result.headline, 'every export on disk reports a clean write \u2014 2 receipts across 3 areas, none failed');
  assert.equal(result.detail, '2 area(s) fully verified, 1 dry-run, 0 switched off.');
});

test('handles singular receipts and areas in verified state', () => {
  const survey = {
    state: 'ok',
    exports: {
      areasCounted: 1,
      byState: { degraded: 0, unreadable: 0, absent: 0, stale: 0, verified: 1, 'not-attempted': 0, skipped: 0, failed: 0 },
      failedReceipts: 0,
      receipts: 1,
      unverifiedReceipts: 0
    }
  };
  const result = exportObservation(survey);
  assert.equal(result.state, 'verified');
  assert.equal(result.tone, 'ok');
  assert.equal(result.headline, 'every export on disk reports a clean write \u2014 1 receipt across 1 area, none failed');
  assert.equal(result.detail, '1 area(s) fully verified, 0 dry-run, 0 switched off.');
});
