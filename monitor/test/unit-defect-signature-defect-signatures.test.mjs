// Computes per-detector defect signatures from scanner findings (monitor/defect-signature.mjs defectSignatures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defectSignatures } from '../defect-signature.mjs';

test('signature is true when population equals minRepos and rate equals threshold', () => {
  const repos = Array.from({ length: 20 }, (_, i) => ({ name: `r${i}`, scanners: { lint: true } }));
  const findings = { lint: Array.from({ length: 20 }, (_, i) => ({ repo: `r${i}`, detector: 'd1' })) };
  const r = defectSignatures({ repos, scannerFindings: findings }, { rate: 0.95, minRepos: 20 });
  assert.deepEqual(r, { at: null, scope: "area", note: "A detector positive on this share of the repositories it scanned is a defect signature in the detector, not a fleet in crisis. Severities on its findings are unchanged here; the lane band carries the flag. rate and population are fields to read, never factors to multiply. The population floor is applied fleet-wide: this area alone rarely reaches it, and the pooled artifact at the reports root (node monitor/defect-signature.mjs --fleet) is the one that judges.", thresholds: { rate: 0.95, minRepos: 20 }, population: { lint: 20 }, detectors: [{ detector: "lint/d1", lane: "lint", id: "d1", population: 20, positives: 20, rate: 1, signature: true }], signatures: [{ detector: "lint/d1", lane: "lint", rate: 1, population: 20, positives: 20, signature: true }], unkeyed: {} });
});

test('signature is false when population is one less than minRepos', () => {
  const repos = Array.from({ length: 19 }, (_, i) => ({ name: `r${i}`, scanners: { lint: true } }));
  const findings = { lint: Array.from({ length: 19 }, (_, i) => ({ repo: `r${i}`, detector: 'd1' })) };
  const r = defectSignatures({ repos, scannerFindings: findings }, { rate: 0.95, minRepos: 20 });
  assert.deepEqual(r, { at: null, scope: "area", note: "A detector positive on this share of the repositories it scanned is a defect signature in the detector, not a fleet in crisis. Severities on its findings are unchanged here; the lane band carries the flag. rate and population are fields to read, never factors to multiply. The population floor is applied fleet-wide: this area alone rarely reaches it, and the pooled artifact at the reports root (node monitor/defect-signature.mjs --fleet) is the one that judges.", thresholds: { rate: 0.95, minRepos: 20 }, population: { lint: 19 }, detectors: [{ detector: "lint/d1", lane: "lint", id: "d1", population: 19, positives: 19, rate: 1, signature: false }], signatures: [], unkeyed: {} });
});

test('signature is true when rate exactly equals threshold', () => {
  const repos = Array.from({ length: 20 }, (_, i) => ({ name: `r${i}`, scanners: { lint: true } }));
  const findings = { lint: Array.from({ length: 19 }, (_, i) => ({ repo: `r${i}`, detector: 'd1' })) };
  const r = defectSignatures({ repos, scannerFindings: findings }, { rate: 0.95, minRepos: 20 });
  assert.deepEqual(r, { at: null, scope: "area", note: "A detector positive on this share of the repositories it scanned is a defect signature in the detector, not a fleet in crisis. Severities on its findings are unchanged here; the lane band carries the flag. rate and population are fields to read, never factors to multiply. The population floor is applied fleet-wide: this area alone rarely reaches it, and the pooled artifact at the reports root (node monitor/defect-signature.mjs --fleet) is the one that judges.", thresholds: { rate: 0.95, minRepos: 20 }, population: { lint: 20 }, detectors: [{ detector: "lint/d1", lane: "lint", id: "d1", population: 20, positives: 19, rate: 0.95, signature: true }], signatures: [{ detector: "lint/d1", lane: "lint", rate: 0.95, population: 20, positives: 19, signature: true }], unkeyed: {} });
});

test('signature is false when rate is slightly below threshold', () => {
  const repos = Array.from({ length: 20 }, (_, i) => ({ name: `r${i}`, scanners: { lint: true } }));
  const findings = { lint: Array.from({ length: 18 }, (_, i) => ({ repo: `r${i}`, detector: 'd1' })) };
  const r = defectSignatures({ repos, scannerFindings: findings }, { rate: 0.95, minRepos: 20 });
  assert.deepEqual(r, { at: null, scope: "area", note: "A detector positive on this share of the repositories it scanned is a defect signature in the detector, not a fleet in crisis. Severities on its findings are unchanged here; the lane band carries the flag. rate and population are fields to read, never factors to multiply. The population floor is applied fleet-wide: this area alone rarely reaches it, and the pooled artifact at the reports root (node monitor/defect-signature.mjs --fleet) is the one that judges.", thresholds: { rate: 0.95, minRepos: 20 }, population: { lint: 20 }, detectors: [{ detector: "lint/d1", lane: "lint", id: "d1", population: 20, positives: 18, rate: 0.9, signature: false }], signatures: [], unkeyed: {} });
});

test('signature is true when population is one and minRepos is one', () => {
  const repos = [{ name: 'r0', scanners: { lint: true } }];
  const findings = { lint: [{ repo: 'r0', detector: 'd1' }] };
  const r = defectSignatures({ repos, scannerFindings: findings }, { rate: 0.95, minRepos: 1 });
  assert.deepEqual(r, { at: null, scope: "area", note: "A detector positive on this share of the repositories it scanned is a defect signature in the detector, not a fleet in crisis. Severities on its findings are unchanged here; the lane band carries the flag. rate and population are fields to read, never factors to multiply. The population floor is applied fleet-wide: this area alone rarely reaches it, and the pooled artifact at the reports root (node monitor/defect-signature.mjs --fleet) is the one that judges.", thresholds: { rate: 0.95, minRepos: 1 }, population: { lint: 1 }, detectors: [{ detector: "lint/d1", lane: "lint", id: "d1", population: 1, positives: 1, rate: 1, signature: true }], signatures: [{ detector: "lint/d1", lane: "lint", rate: 1, population: 1, positives: 1, signature: true }], unkeyed: {} });
});

test('signature is false when population is zero', () => {
  const repos = [];
  const findings = { lint: [] };
  const r = defectSignatures({ repos, scannerFindings: findings }, { rate: 0.95, minRepos: 20 });
  assert.deepEqual(r, { at: null, scope: "area", note: "A detector positive on this share of the repositories it scanned is a defect signature in the detector, not a fleet in crisis. Severities on its findings are unchanged here; the lane band carries the flag. rate and population are fields to read, never factors to multiply. The population floor is applied fleet-wide: this area alone rarely reaches it, and the pooled artifact at the reports root (node monitor/defect-signature.mjs --fleet) is the one that judges.", thresholds: { rate: 0.95, minRepos: 20 }, population: {}, detectors: [], signatures: [], unkeyed: {} });
});
