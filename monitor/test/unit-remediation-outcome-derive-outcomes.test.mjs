// Derives verified or refuted remediation outcomes from scanner annotations and ledger entries (monitor/remediation-outcome.mjs deriveOutcomes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveOutcomes } from '../remediation-outcome.mjs';

test('empty inputs yield empty outcomes and zero counts', () => {
  const r = deriveOutcomes(null, {});
  assert.deepEqual(r, { outcomes: [], skipped: [], counts: { scannerAnnotation: 0, remediationLedger: 0 } });
});

test('scanner annotation with unknown category is skipped', () => {
  const r = deriveOutcomes({ sliceId: 's1', scannerFindings: {}, scannerDelta: { notCompared: [] } }, { scannerAnnotations: [{ claim: 'remediated', category: 'mystery', repo: 'r1' }] });
  assert.deepEqual(r, { outcomes: [], skipped: [{ reason: "unknown category 'mystery'" }], counts: { scannerAnnotation: 0, remediationLedger: 0 } });
});

test('scanner annotation without slice data is skipped', () => {
  const r = deriveOutcomes(null, { scannerAnnotations: [{ claim: 'remediated', category: 'dep', repo: 'r1', vulnId: 'CVE-1', package: 'pkg' }] });
  assert.deepEqual(r, { outcomes: [], skipped: [{ reason: "unknown category 'dep'" }], counts: { scannerAnnotation: 0, remediationLedger: 0 } });
});

test('scanner annotation in notCompared category is skipped', () => {
  const r = deriveOutcomes({ sliceId: 's1', scannerFindings: { dep: [] }, scannerDelta: { notCompared: ['dep:reason'] } }, { scannerAnnotations: [{ claim: 'remediated', category: 'dep', repo: 'r1', vulnId: 'CVE-1', package: 'pkg' }] });
  assert.deepEqual(r, { outcomes: [], skipped: [{ reason: "unknown category 'dep'" }], counts: { scannerAnnotation: 0, remediationLedger: 0 } });
});

test('scanner annotation without repo and not fleet scope is skipped', () => {
  const r = deriveOutcomes({ sliceId: 's1', scannerFindings: { dep: [] }, scannerDelta: { notCompared: [] } }, { scannerAnnotations: [{ claim: 'remediated', category: 'dep', vulnId: 'CVE-1', package: 'pkg' }] });
  assert.deepEqual(r, { outcomes: [], skipped: [{ reason: "unknown category 'dep'" }], counts: { scannerAnnotation: 0, remediationLedger: 0 } });
});

test('scanner annotation with non-remediated claim is ignored', () => {
  const r = deriveOutcomes({ sliceId: 's1', scannerFindings: { dep: [] }, scannerDelta: { notCompared: [] } }, { scannerAnnotations: [{ claim: 'open', category: 'dep', repo: 'r1', vulnId: 'CVE-1', package: 'pkg' }] });
  assert.deepEqual(r, { outcomes: [], skipped: [], counts: { scannerAnnotation: 0, remediationLedger: 0 } });
});

test('ledger entry with weak evidence tier is skipped', () => {
  const r = deriveOutcomes({ sliceId: 's1', findings: [], carried: [] }, { ledgerEntries: [{ key: 'k1', evidence: { tier: 'weak' }, repo: 'r1', vulnId: 'CVE-1', package: 'pkg' }] });
  assert.deepEqual(r, { outcomes: [], skipped: [{ reason: "k1: weak tier is unconfirmed \u2014 never a remediation claim" }], counts: { scannerAnnotation: 0, remediationLedger: 0 } });
});

test('ledger entry missing required fields is skipped', () => {
  const r = deriveOutcomes({ sliceId: 's1', findings: [], carried: [] }, { ledgerEntries: [{ key: 'k1', repo: 'r1' }] });
  assert.deepEqual(r, { outcomes: [], skipped: [{ reason: "k1: missing repo/vulnId/package \u2014 cannot key an outcome" }], counts: { scannerAnnotation: 0, remediationLedger: 0 } });
});

test('ledger entry without findings data is skipped', () => {
  const r = deriveOutcomes(null, { ledgerEntries: [{ key: 'k1', repo: 'r1', vulnId: 'CVE-1', package: 'pkg' }] });
  assert.deepEqual(r, { outcomes: [], skipped: [{ reason: "k1: slice carries no findings/carried arrays \u2014 comparability unknown" }], counts: { scannerAnnotation: 0, remediationLedger: 0 } });
});

test('ledger entry carried but not in findings is skipped', () => {
  const r = deriveOutcomes({ sliceId: 's1', findings: [], carried: [{ key: 'k1' }] }, { ledgerEntries: [{ key: 'k1', repo: 'r1', vulnId: 'CVE-1', package: 'pkg' }] });
  assert.deepEqual(r, { outcomes: [], skipped: [{ reason: "k1: not rescanned this slice (carried) \u2014 proves nothing" }], counts: { scannerAnnotation: 0, remediationLedger: 0 } });
});
