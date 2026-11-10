// Builds the advisory row for a WordPress component (bin/wp-advisories.mjs rowFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowFor } from '../wp-advisories.mjs';

test('returns null when there are no records and release status is not insecure', () => {
  const r = rowFor({ rule: 'wp-core-vulnerable', path: 'p', slug: 's', version: '1.0', records: [], releaseStatus: null });
  assert.equal(r, null);
});

test('returns a row with insecure status when there are no records', () => {
  const r = rowFor({ rule: 'wp-core-vulnerable', path: 'p', slug: 's', version: '1.0', records: [], releaseStatus: 'insecure' });
  assert.deepEqual(r, { rule: "wp-core-vulnerable", path: "p", sev: "", cwe: "CWE-1395", component: "s", version: "1.0", advisories: 0, ids: [], kev: false, exploited: false, fixedIn: null, detail: "api.wordpress.org lists s 1.0 as insecure: a later release in its branch fixes a security issue" });
});

test('returns a row with one record and no overlap note', () => {
  const r = rowFor({ rule: 'wp-core-vulnerable', path: 'p', slug: 's', version: '1.0', records: [{ impact: { cvss3: { score: 9.8 }, ssvc: { kev: true, exploitation: 'active' }, cwe: [{ cwe: 'CWE-1395' }] }, source: [{ id: 'CVE-2024-0001', name: 'Critical Flaw' }] }], releaseStatus: null, overlapNote: false });
  assert.deepEqual(r, { rule: "wp-core-vulnerable", path: "p", sev: "crit", cwe: "CWE-1395", component: "s", version: "1.0", advisories: 1, ids: ["CVE-2024-0001"], kev: true, exploited: true, fixedIn: null, detail: "1 advisory record(s) apply to s 1.0; ids CVE-2024-0001; including: Critical Flaw; worst CVSS 9.8; 1 marked actively exploited, 1 on CISA KEV; CWE-1395" });
});

test('returns a row with one record and overlap note enabled', () => {
  const r = rowFor({ rule: 'wp-core-vulnerable', path: 'p', slug: 's', version: '1.0', records: [{ impact: { cvss3: { score: 9.8 }, ssvc: { kev: true, exploitation: 'active' }, cwe: [{ cwe: 'CWE-1395' }] }, source: [{ id: 'CVE-2024-0001', name: 'Critical Flaw' }] }], releaseStatus: null, overlapNote: true });
  assert.deepEqual(r, { rule: "wp-core-vulnerable", path: "p", sev: "crit", cwe: "CWE-1395", component: "s", version: "1.0", advisories: 1, ids: ["CVE-2024-0001"], kev: true, exploited: true, fixedIn: null, detail: "1 advisory record(s) apply to s 1.0 (records from different sources overlap: one flaw can appear as a CVE, an EUVD entry and a vendor record); ids CVE-2024-0001; including: Critical Flaw; worst CVSS 9.8; 1 marked actively exploited, 1 on CISA KEV; CWE-1395" });
});

test('returns a row with two records of equal score', () => {
  const r = rowFor({ rule: 'wp-core-vulnerable', path: 'p', slug: 's', version: '1.0', records: [{ impact: { cvss3: { score: 5.0 } }, source: [{ id: 'CVE-2024-0001', name: 'A' }] }, { impact: { cvss3: { score: 5.0 } }, source: [{ id: 'CVE-2024-0002', name: 'B' }] }], releaseStatus: null, overlapNote: false });
  assert.deepEqual(r, { rule: "wp-core-vulnerable", path: "p", sev: "med", cwe: "CWE-1395", component: "s", version: "1.0", advisories: 2, ids: ["CVE-2024-0001", "CVE-2024-0002"], kev: false, exploited: false, fixedIn: null, detail: "2 advisory record(s) apply to s 1.0; ids CVE-2024-0001, CVE-2024-0002; including: A | B; worst CVSS 5.0" });
});

test('returns a row with two records where the second has a higher score', () => {
  const r = rowFor({ rule: 'wp-core-vulnerable', path: 'p', slug: 's', version: '1.0', records: [{ impact: { cvss3: { score: 5.0 } }, source: [{ id: 'CVE-2024-0001', name: 'A' }] }, { impact: { cvss3: { score: 9.8 } }, source: [{ id: 'CVE-2024-0002', name: 'B' }] }], releaseStatus: null, overlapNote: false });
  assert.deepEqual(r, { rule: "wp-core-vulnerable", path: "p", sev: "crit", cwe: "CWE-1395", component: "s", version: "1.0", advisories: 2, ids: ["CVE-2024-0001", "CVE-2024-0002"], kev: false, exploited: false, fixedIn: null, detail: "2 advisory record(s) apply to s 1.0; ids CVE-2024-0001, CVE-2024-0002; including: B | A; worst CVSS 9.8" });
});

test('returns a row with 20 ids exactly at the cap', () => {
  const records = Array.from({ length: 20 }, (_, i) => ({ impact: { cvss3: { score: 5.0 } }, source: [{ id: `CVE-2024-${String(i).padStart(4, '0')}`, name: `T${i}` }] }));
  const r = rowFor({ rule: 'wp-core-vulnerable', path: 'p', slug: 's', version: '1.0', records, releaseStatus: null, overlapNote: false });
  assert.deepEqual(r, { rule: "wp-core-vulnerable", path: "p", sev: "med", cwe: "CWE-1395", component: "s", version: "1.0", advisories: 20, ids: ["CVE-2024-0000", "CVE-2024-0001", "CVE-2024-0002", "CVE-2024-0003", "CVE-2024-0004", "CVE-2024-0005", "CVE-2024-0006", "CVE-2024-0007", "CVE-2024-0008", "CVE-2024-0009", "CVE-2024-0010", "CVE-2024-0011", "CVE-2024-0012", "CVE-2024-0013", "CVE-2024-0014", "CVE-2024-0015", "CVE-2024-0016", "CVE-2024-0017", "CVE-2024-0018", "CVE-2024-0019"], kev: false, exploited: false, fixedIn: null, detail: "20 advisory record(s) apply to s 1.0; ids CVE-2024-0000, CVE-2024-0001, CVE-2024-0002, CVE-2024-0003, CVE-2024-0004, CVE-2024-0005, CVE-2024-0006, CVE-2024-0007, CVE-2024-0008, CVE-2024-0009, CVE-2024-0010, CVE-2024-0011, CVE-2024-0012, CVE-2024-0013, CVE-2024-0014, CVE-2024-0015, CVE-2024-0016, CVE-2024-0017, CVE-2024-0018, CVE-2024-0019; including: T0 | T1 | T2; worst CVSS 5.0" });
});

test('returns a row with 21 ids exceeding the cap', () => {
  const records = Array.from({ length: 21 }, (_, i) => ({ impact: { cvss3: { score: 5.0 } }, source: [{ id: `CVE-2024-${String(i).padStart(4, '0')}`, name: `T${i}` }] }));
  const r = rowFor({ rule: 'wp-core-vulnerable', path: 'p', slug: 's', version: '1.0', records, releaseStatus: null, overlapNote: false });
  assert.deepEqual(r, { rule: "wp-core-vulnerable", path: "p", sev: "med", cwe: "CWE-1395", component: "s", version: "1.0", advisories: 21, ids: ["CVE-2024-0000", "CVE-2024-0001", "CVE-2024-0002", "CVE-2024-0003", "CVE-2024-0004", "CVE-2024-0005", "CVE-2024-0006", "CVE-2024-0007", "CVE-2024-0008", "CVE-2024-0009", "CVE-2024-0010", "CVE-2024-0011", "CVE-2024-0012", "CVE-2024-0013", "CVE-2024-0014", "CVE-2024-0015", "CVE-2024-0016", "CVE-2024-0017", "CVE-2024-0018", "CVE-2024-0019"], kev: false, exploited: false, fixedIn: null, detail: "21 advisory record(s) apply to s 1.0; ids CVE-2024-0000, CVE-2024-0001, CVE-2024-0002, CVE-2024-0003, CVE-2024-0004, CVE-2024-0005, CVE-2024-0006, CVE-2024-0007, CVE-2024-0008, CVE-2024-0009, CVE-2024-0010, CVE-2024-0011, CVE-2024-0012, CVE-2024-0013, CVE-2024-0014, CVE-2024-0015, CVE-2024-0016, CVE-2024-0017, CVE-2024-0018, CVE-2024-0019, +1 more; including: T0 | T1 | T2; worst CVSS 5.0" });
});

test('returns a row with one record and no cvss score', () => {
  const r = rowFor({ rule: 'wp-core-vulnerable', path: 'p', slug: 's', version: '1.0', records: [{ impact: {}, source: [{ id: 'CVE-2024-0001', name: 'A' }] }], releaseStatus: null, overlapNote: false });
  assert.deepEqual(r, { rule: "wp-core-vulnerable", path: "p", sev: "", cwe: "CWE-1395", component: "s", version: "1.0", advisories: 1, ids: ["CVE-2024-0001"], kev: false, exploited: false, fixedIn: null, detail: "1 advisory record(s) apply to s 1.0; ids CVE-2024-0001; including: A; no record carries a CVSS score, so the severity is undetermined" });
});

test('returns a row with one record and insecure release status', () => {
  const r = rowFor({ rule: 'wp-core-vulnerable', path: 'p', slug: 's', version: '1.0', records: [{ impact: { cvss3: { score: 9.8 } }, source: [{ id: 'CVE-2024-0001', name: 'A' }] }], releaseStatus: 'insecure', overlapNote: false });
  assert.deepEqual(r, { rule: "wp-core-vulnerable", path: "p", sev: "crit", cwe: "CWE-1395", component: "s", version: "1.0", advisories: 1, ids: ["CVE-2024-0001"], kev: false, exploited: false, fixedIn: null, detail: "1 advisory record(s) apply to s 1.0; ids CVE-2024-0001; including: A; worst CVSS 9.8; api.wordpress.org lists s 1.0 as insecure: a later release in its branch fixes a security issue" });
});
