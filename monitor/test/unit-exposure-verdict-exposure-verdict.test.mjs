// Computes the exposure verdict for a rollup (monitor/exposure-verdict.mjs exposureVerdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exposureVerdict } from '../exposure-verdict.mjs';

test('returns crit severity when findings exist', () => {
  const r = exposureVerdict({ findings: { crit: 1 }, repos: [{ worst: 'ok' }], ageHours: 1 });
  assert.deepEqual(r, { worst: "crit", noscanRepos: 0, scannedRepos: 1, stale: false, verdictBasis: "1 crit finding(s)" });
});

test('returns not-scanned when no repos are listed', () => {
  const r = exposureVerdict({ repos: [], ageHours: 1 });
  assert.deepEqual(r, { worst: "not-scanned", noscanRepos: 0, scannedRepos: 0, stale: false, verdictBasis: "the rollup lists no repos" });
});

test('returns not-scanned when all repos did not scan', () => {
  const r = exposureVerdict({ repos: [{ noscan: true }], ageHours: 1 });
  assert.deepEqual(r, { worst: "not-scanned", noscanRepos: 1, scannedRepos: 0, stale: false, verdictBasis: "no repo in this area was scanned" });
});

test('returns partial when some repos did not scan', () => {
  const r = exposureVerdict({ repos: [{ worst: 'ok' }, { noscan: true }], ageHours: 1 });
  assert.deepEqual(r, { worst: "partial", noscanRepos: 1, scannedRepos: 1, stale: false, verdictBasis: "1 of 2 repo(s) were not scanned \u2014 no findings is not a clean result here" });
});

test('returns stale when age is unknown', () => {
  const r = exposureVerdict({ repos: [{ worst: 'ok' }], ageHours: null });
  assert.deepEqual(r, { worst: "stale", noscanRepos: 0, scannedRepos: 1, stale: null, verdictBasis: "no findings, but the rollup carries no timestamp so its age cannot be established" });
});

test('returns stale when age exceeds threshold', () => {
  const r = exposureVerdict({ repos: [{ worst: 'ok' }], ageHours: 25 });
  assert.deepEqual(r, { worst: "stale", noscanRepos: 0, scannedRepos: 1, stale: true, verdictBasis: "no findings, but the scan is 25h old (> 24h) and may not describe what is deployed now" });
});

test('returns none when all repos scanned and age is fresh', () => {
  const r = exposureVerdict({ repos: [{ worst: 'ok' }], ageHours: 1 });
  assert.deepEqual(r, { worst: "none", noscanRepos: 0, scannedRepos: 1, stale: false, verdictBasis: "every repo scanned (1), 1h ago" });
});

test('returns none when age equals threshold exactly', () => {
  const r = exposureVerdict({ repos: [{ worst: 'ok' }], ageHours: 24 });
  assert.deepEqual(r, { worst: "none", noscanRepos: 0, scannedRepos: 1, stale: false, verdictBasis: "every repo scanned (1), 24h ago" });
});
