// Maps ledger entries to verified-fixed or refuted-still-present outcomes (monitor/remediation-outcome.mjs deriveLedgerClaimOutcomes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveLedgerClaimOutcomes } from '../remediation-outcome.mjs';

test('slice with stamp but no sliceId yields stamp as sliceId', () => {
  const r = deriveLedgerClaimOutcomes([], { stamp: 's1' });
  assert.deepEqual(r, { out: [], skipped: [] });
});

test('slice with sliceId but no stamp yields sliceId as sliceId', () => {
  const r = deriveLedgerClaimOutcomes([], { sliceId: 's2' });
  assert.deepEqual(r, { out: [], skipped: [] });
});

test('slice with both sliceId and stamp yields sliceId as sliceId', () => {
  const r = deriveLedgerClaimOutcomes([], { sliceId: 's3', stamp: 't3' });
  assert.deepEqual(r, { out: [], skipped: [] });
});

test('null slice yields null sliceId and skips entries for missing findings data', () => {
  const r = deriveLedgerClaimOutcomes([{ key: 'k1', repo: 'r', vulnId: 'v', package: 'p' }], null);
  assert.deepEqual(r, { out: [], skipped: [{ reason: "k1: slice carries no findings/carried arrays \u2014 comparability unknown" }] });
});

test('ledger entry with null key is skipped with missing key reason', () => {
  const r = deriveLedgerClaimOutcomes([null], { findings: [], carried: [] });
  assert.deepEqual(r, { out: [], skipped: [{ reason: "ledger entry missing key" }] });
});

test('ledger entry with weak evidence tier is skipped as unconfirmed', () => {
  const r = deriveLedgerClaimOutcomes([{ key: 'k1', repo: 'r', vulnId: 'v', package: 'p', evidence: { tier: 'weak' } }], { findings: [], carried: [] });
  assert.deepEqual(r, { out: [], skipped: [{ reason: "k1: weak tier is unconfirmed \u2014 never a remediation claim" }] });
});

test('ledger entry with strong evidence tier is not skipped for weak tier', () => {
  const r = deriveLedgerClaimOutcomes([{ key: 'k1', repo: 'r', vulnId: 'v', package: 'p', evidence: { tier: 'strong' } }], { findings: [], carried: [] });
  assert.deepEqual(r, { out: [{ findingKey: "r|v|p", category: "dependency-cve", repo: "r", outcome: "verified-fixed", claimSource: "remediation-ledger", claimRef: "ledger:k1@undefined", sliceId: null, bornSlice: null, place: "dependency-cve:r", artifact: "monitor/remediation-ledger.json#entries" }], skipped: [] });
});

test('ledger entry missing repo is skipped with cannot key reason', () => {
  const r = deriveLedgerClaimOutcomes([{ key: 'k1', vulnId: 'v', package: 'p' }], { findings: [], carried: [] });
  assert.deepEqual(r, { out: [], skipped: [{ reason: "k1: missing repo/vulnId/package \u2014 cannot key an outcome" }] });
});

test('ledger entry missing vulnId is skipped with cannot key reason', () => {
  const r = deriveLedgerClaimOutcomes([{ key: 'k1', repo: 'r', package: 'p' }], { findings: [], carried: [] });
  assert.deepEqual(r, { out: [], skipped: [{ reason: "k1: missing repo/vulnId/package \u2014 cannot key an outcome" }] });
});

test('ledger entry missing package is skipped with cannot key reason', () => {
  const r = deriveLedgerClaimOutcomes([{ key: 'k1', repo: 'r', vulnId: 'v' }], { findings: [], carried: [] });
  assert.deepEqual(r, { out: [], skipped: [{ reason: "k1: missing repo/vulnId/package \u2014 cannot key an outcome" }] });
});

test('entry not in findings but in carried is skipped as not rescanned', () => {
  const r = deriveLedgerClaimOutcomes([{ key: 'k1', repo: 'r', vulnId: 'v', package: 'p' }], { findings: [], carried: [{ key: 'k1' }] });
  assert.deepEqual(r, { out: [], skipped: [{ reason: "k1: not rescanned this slice (carried) \u2014 proves nothing" }] });
});

test('entry in findings and carried is not skipped and yields refuted-still-present', () => {
  const r = deriveLedgerClaimOutcomes([{ key: 'k1', repo: 'r', vulnId: 'v', package: 'p' }], { findings: [{ key: 'k1' }], carried: [{ key: 'k1' }] });
  assert.deepEqual(r, { out: [{ findingKey: "r|v|p", category: "dependency-cve", repo: "r", outcome: "refuted-still-present", claimSource: "remediation-ledger", claimRef: "ledger:k1@undefined", sliceId: null, bornSlice: null, place: "dependency-cve:r", artifact: "monitor/remediation-ledger.json#entries" }], skipped: [] });
});

test('entry in findings but not carried yields verified-fixed', () => {
  const r = deriveLedgerClaimOutcomes([{ key: 'k1', repo: 'r', vulnId: 'v', package: 'p' }], { findings: [{ key: 'k1' }], carried: [] });
  assert.deepEqual(r, { out: [{ findingKey: "r|v|p", category: "dependency-cve", repo: "r", outcome: "refuted-still-present", claimSource: "remediation-ledger", claimRef: "ledger:k1@undefined", sliceId: null, bornSlice: null, place: "dependency-cve:r", artifact: "monitor/remediation-ledger.json#entries" }], skipped: [] });
});

test('entry not in findings and not in carried yields verified-fixed', () => {
  const r = deriveLedgerClaimOutcomes([{ key: 'k1', repo: 'r', vulnId: 'v', package: 'p' }], { findings: [], carried: [] });
  assert.deepEqual(r, { out: [{ findingKey: "r|v|p", category: "dependency-cve", repo: "r", outcome: "verified-fixed", claimSource: "remediation-ledger", claimRef: "ledger:k1@undefined", sliceId: null, bornSlice: null, place: "dependency-cve:r", artifact: "monitor/remediation-ledger.json#entries" }], skipped: [] });
});

test('two entries with same findingKey preserve stable sort order', () => {
  const r = deriveLedgerClaimOutcomes(
    [
      { key: 'k1', repo: 'r', vulnId: 'v', package: 'p' },
      { key: 'k2', repo: 'r', vulnId: 'v', package: 'p' }
    ],
    { findings: [], carried: [] }
  );
  assert.deepEqual(r, { out: [{ findingKey: "r|v|p", category: "dependency-cve", repo: "r", outcome: "verified-fixed", claimSource: "remediation-ledger", claimRef: "ledger:k1@undefined", sliceId: null, bornSlice: null, place: "dependency-cve:r", artifact: "monitor/remediation-ledger.json#entries" }, { findingKey: "r|v|p", category: "dependency-cve", repo: "r", outcome: "verified-fixed", claimSource: "remediation-ledger", claimRef: "ledger:k2@undefined", sliceId: null, bornSlice: null, place: "dependency-cve:r", artifact: "monitor/remediation-ledger.json#entries" }], skipped: [] });
});

test('two entries with different findingKeys are sorted ascending', () => {
  const r = deriveLedgerClaimOutcomes(
    [
      { key: 'k2', repo: 'r2', vulnId: 'v2', package: 'p2' },
      { key: 'k1', repo: 'r1', vulnId: 'v1', package: 'p1' }
    ],
    { findings: [], carried: [] }
  );
  assert.deepEqual(r, { out: [{ findingKey: "r1|v1|p1", category: "dependency-cve", repo: "r1", outcome: "verified-fixed", claimSource: "remediation-ledger", claimRef: "ledger:k1@undefined", sliceId: null, bornSlice: null, place: "dependency-cve:r1", artifact: "monitor/remediation-ledger.json#entries" }, { findingKey: "r2|v2|p2", category: "dependency-cve", repo: "r2", outcome: "verified-fixed", claimSource: "remediation-ledger", claimRef: "ledger:k2@undefined", sliceId: null, bornSlice: null, place: "dependency-cve:r2", artifact: "monitor/remediation-ledger.json#entries" }], skipped: [] });
});
