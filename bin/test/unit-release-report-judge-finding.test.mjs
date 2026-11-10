// Computes the blocking decision, reason, and enriched severity/cvss/epss for a single finding (bin/release-report.mjs judgeFinding).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeFinding } from '../release-report.mjs';

test('uses advisory index entry when finding id is present in index', () => {
  const f = { id: 'CVE-2024-0001', cves: ['CVE-2024-0001'], severity: 'unknown', cvss: null, runtime: true, epss: null };
  const policy = { runtime_only: false, kev: false, critical: false, high_epss_min: 0.5 };
  const ctx = { index: { advisories: { 'CVE-2024-0001': { s3: 9.8 } } }, byCve: new Map(), kev: new Set(), epssDoc: null };
  const result = judgeFinding(f, policy, ctx);
  assert.deepEqual(result, { blocking: false, reason: "no policy rule fires", severity: "critical", cvss: 9.8, cvss_source: "advisory index s3", kev: false, epss: null, epss_source: "none" });
});

test('falls back to byCve map when finding id is not in index', () => {
  const f = { id: 'UNKNOWN-ID', cves: ['CVE-2024-0002'], severity: 'unknown', cvss: null, runtime: true, epss: null };
  const policy = { runtime_only: false, kev: false, critical: false, high_epss_min: 0.5 };
  const ctx = { index: { advisories: {} }, byCve: new Map([['CVE-2024-0002', { s3: 7.5 }]]), kev: new Set(), epssDoc: null };
  const result = judgeFinding(f, policy, ctx);
  assert.deepEqual(result, { blocking: false, reason: "high severity but EPSS unknown; not blocking", severity: "high", cvss: 7.5, cvss_source: "advisory index s3", kev: false, epss: null, epss_source: "none" });
});

test('keeps box cvss when finding has numeric cvss', () => {
  const f = { id: 'CVE-2024-0003', cves: ['CVE-2024-0003'], severity: 'high', cvss: 8.1, runtime: true, epss: null };
  const policy = { runtime_only: false, kev: false, critical: false, high_epss_min: 0.5 };
  const ctx = { index: { advisories: { 'CVE-2024-0003': { s3: 9.8 } } }, byCve: new Map(), kev: new Set(), epssDoc: null };
  const result = judgeFinding(f, policy, ctx);
  assert.deepEqual(result, { blocking: false, reason: "high severity but EPSS unknown; not blocking", severity: "high", cvss: 8.1, cvss_source: "box", kev: false, epss: null, epss_source: "none" });
});

test('maps moderate label to medium when severity is unknown and no cvss available', () => {
  const f = { id: 'CVE-2024-0004', cves: ['CVE-2024-0004'], severity: 'unknown', cvss: null, runtime: true, epss: null };
  const policy = { runtime_only: false, kev: false, critical: false, high_epss_min: 0.5 };
  const ctx = { index: { advisories: { 'CVE-2024-0004': { label: 'moderate' } } }, byCve: new Map(), kev: new Set(), epssDoc: null };
  const result = judgeFinding(f, policy, ctx);
  assert.deepEqual(result, { blocking: false, reason: "no policy rule fires", severity: "medium", cvss: null, cvss_source: "none", kev: false, epss: null, epss_source: "none" });
});

test('does not override non-unknown severity with entry label', () => {
  const f = { id: 'CVE-2024-0005', cves: ['CVE-2024-0005'], severity: 'low', cvss: null, runtime: true, epss: null };
  const policy = { runtime_only: false, kev: false, critical: false, high_epss_min: 0.5 };
  const ctx = { index: { advisories: { 'CVE-2024-0005': { label: 'moderate' } } }, byCve: new Map(), kev: new Set(), epssDoc: null };
  const result = judgeFinding(f, policy, ctx);
  assert.deepEqual(result, { blocking: false, reason: "no policy rule fires", severity: "low", cvss: null, cvss_source: "none", kev: false, epss: null, epss_source: "none" });
});

test('blocks when finding is listed in CISA KEV', () => {
  const f = { id: 'CVE-2024-0006', cves: ['CVE-2024-0006'], severity: 'medium', cvss: null, runtime: true, epss: null };
  const policy = { runtime_only: false, kev: true, critical: false, high_epss_min: 0.5 };
  const ctx = { index: { advisories: {} }, byCve: new Map(), kev: new Set(['CVE-2024-0006']), epssDoc: null };
  const result = judgeFinding(f, policy, ctx);
  assert.deepEqual(result, { blocking: true, reason: "listed in CISA KEV", severity: "medium", cvss: null, cvss_source: "none", kev: true, epss: null, epss_source: "none" });
});

test('blocks when severity is critical and policy requires critical', () => {
  const f = { id: 'CVE-2024-0007', cves: ['CVE-2024-0007'], severity: 'critical', cvss: null, runtime: true, epss: null };
  const policy = { runtime_only: false, kev: false, critical: true, high_epss_min: 0.5 };
  const ctx = { index: { advisories: {} }, byCve: new Map(), kev: new Set(), epssDoc: null };
  const result = judgeFinding(f, policy, ctx);
  assert.deepEqual(result, { blocking: true, reason: "critical severity", severity: "critical", cvss: null, cvss_source: "none", kev: false, epss: null, epss_source: "none" });
});

test('blocks high severity when epss meets or exceeds threshold', () => {
  const f = { id: 'CVE-2024-0008', cves: ['CVE-2024-0008'], severity: 'high', cvss: null, runtime: true, epss: 0.6 };
  const policy = { runtime_only: false, kev: false, critical: false, high_epss_min: 0.5 };
  const ctx = { index: { advisories: {} }, byCve: new Map(), kev: new Set(), epssDoc: null };
  const result = judgeFinding(f, policy, ctx);
  assert.deepEqual(result, { blocking: true, reason: "high severity with EPSS 0.6 >= 0.5", severity: "high", cvss: null, cvss_source: "none", kev: false, epss: 0.6, epss_source: "box" });
});

test('does not block high severity when epss is below threshold', () => {
  const f = { id: 'CVE-2024-0009', cves: ['CVE-2024-0009'], severity: 'high', cvss: null, runtime: true, epss: 0.4 };
  const policy = { runtime_only: false, kev: false, critical: false, high_epss_min: 0.5 };
  const ctx = { index: { advisories: {} }, byCve: new Map(), kev: new Set(), epssDoc: null };
  const result = judgeFinding(f, policy, ctx);
  assert.deepEqual(result, { blocking: false, reason: "no policy rule fires", severity: "high", cvss: null, cvss_source: "none", kev: false, epss: 0.4, epss_source: "box" });
});

test('does not block high severity when epss is unknown', () => {
  const f = { id: 'CVE-2024-0010', cves: ['CVE-2024-0010'], severity: 'high', cvss: null, runtime: true, epss: null };
  const policy = { runtime_only: false, kev: false, critical: false, high_epss_min: 0.5 };
  const ctx = { index: { advisories: {} }, byCve: new Map(), kev: new Set(), epssDoc: null };
  const result = judgeFinding(f, policy, ctx);
  assert.deepEqual(result, { blocking: false, reason: "high severity but EPSS unknown; not blocking", severity: "high", cvss: null, cvss_source: "none", kev: false, epss: null, epss_source: "none" });
});
