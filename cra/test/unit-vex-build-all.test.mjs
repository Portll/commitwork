// The CycloneDX, CSAF 2.0, CSAF 2.1 and OpenVEX documents for one product's findings (cra/vex.mjs buildAll).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAll } from '../vex.mjs';

const product = { id: 'p1', name: 'P', version: '1.0', repos: ['r1'] };
const maker = { name: 'M', contact: 'm@x' };
const at = '2024-01-01T00:00:00Z';
const none = { annotations: [] };
const roll = (o) => ({ sliceId: 's1', repos: [{ name: 'r1', findings: [{ id: 'CVE-2024-0001', package: 'pkg', version: '1.0', ...o }] }] });
const states = (r) => r.cdx.vulnerabilities.map((v) => [v.id, v.analysis.state, v.analysis.response]);
const accept = (o) => ({ annotations: [{ id: 'CVE-2024-0001', action: 'accept', ...o }] });
const kev = { 'CVE-2024-0001': { dateAdded: '2024-02-01', dueDate: '2024-02-22', requiredAction: 'Patch it.', knownRansomwareCampaignUse: 'Known', cwes: [] } };
const impact = { category: 'impact', details: 'Status: exploitable', product_ids: ['CSAFPID-0001'] };
const kevThreat = { category: 'exploit_status', date: '2024-02-01', details: 'Listed in CISA Known Exploited Vulnerabilities catalogue on 2024-02-01. Known ransomware campaign use: Known.' };
const kevRemediation = { category: 'mitigation', date: '2024-02-22', details: 'CISA KEV required action: Patch it. (KEV-mandated remediation due 2024-02-22.)', product_ids: ['CSAFPID-0001'] };

test('a rollup with no findings and no ledger entries yields documents with no vulnerabilities', () => {
  const r = buildAll(product, maker, { sliceId: 's1', repos: [] }, [], none, at);
  assert.deepEqual(r.cdx.vulnerabilities, []);
  assert.deepEqual(r.csaf21.vulnerabilities, []);
  assert.deepEqual(r.openvex.statements, []);
});

test('an unannotated persisting finding is exploitable and its detail names the slice', () => {
  const r = buildAll(product, maker, roll({ state: 'persisting' }), [], none, at);
  assert.deepEqual(states(r), [['CVE-2024-0001', 'exploitable', undefined]]);
  assert.equal(r.cdx.vulnerabilities[0].analysis.detail, 'open in slice s1 (state: persisting; KEV=false; EPSS=unknown)');
});

test('a finding that was never scanned is in triage', () => {
  const r = buildAll(product, maker, roll({ state: 'unknown-not-scanned' }), [], none, at);
  assert.deepEqual(states(r), [['CVE-2024-0001', 'in_triage', undefined]]);
});

test('an accept annotation dated exactly at the build time applies but one a millisecond later does not', () => {
  const on = buildAll(product, maker, roll({ state: 'persisting' }), [], accept({ at: '2024-01-01T00:00:00Z' }), at);
  const off = buildAll(product, maker, roll({ state: 'persisting' }), [], accept({ at: '2024-01-01T00:00:00.001Z' }), at);
  assert.deepEqual(states(on), [['CVE-2024-0001', 'exploitable', ['will_not_fix']]]);
  assert.deepEqual(states(off), [['CVE-2024-0001', 'exploitable', undefined]]);
});

test('an annotation expiring exactly at the build time is inactive but one expiring a millisecond later applies', () => {
  const off = buildAll(product, maker, roll({ state: 'persisting' }), [], accept({ expires: '2024-01-01T00:00:00Z' }), at);
  const on = buildAll(product, maker, roll({ state: 'persisting' }), [], accept({ expires: '2024-01-01T00:00:00.001Z' }), at);
  assert.deepEqual(states(off), [['CVE-2024-0001', 'exploitable', undefined]]);
  assert.deepEqual(states(on), [['CVE-2024-0001', 'exploitable', ['will_not_fix']]]);
});

test('medium-evidence ledger fixes are resolved while weak-evidence fixes are left out', () => {
  const ledger = [
    { vulnId: 'cve-2024-0002', repo: 'r1', package: 'pkg', toVersion: '2.0', evidence: { tier: 'medium', detail: 'd' } },
    { vulnId: 'cve-2024-0003', repo: 'r1', evidence: { tier: 'weak', detail: 'd' } },
  ];
  const r = buildAll(product, maker, { sliceId: 's1', repos: [] }, ledger, none, at);
  assert.deepEqual(states(r), [['CVE-2024-0002', 'resolved', undefined]]);
});

test('the CycloneDX document declares a lossless fidelity ledger for one exploitable statement', () => {
  const r = buildAll(product, maker, roll({ state: 'persisting' }), [], none, at);
  const prop = r.cdx.metadata.properties[1];
  assert.equal(prop.name, 'commitwork:fidelity');
  const { note, ...rest } = JSON.parse(prop.value);
  assert.deepEqual(rest, { exact: 0, narrowed: 1, prose_only: 0, unrepresentable: 0, lost: [], statements: 1, lossless: true });
});

test('a KEV catalogue alone without EPSS detail still enriches the CSAF 2.1 document', () => {
  const r = buildAll(product, maker, roll({ state: 'persisting' }), [], none, at, { kev });
  const v = r.csaf21.vulnerabilities[0];
  assert.deepEqual(v.threats, [{ category: "exploit_status", details: "CISA Known Exploited Vulnerabilities catalogue. Catalogued 2024-02-01. Known ransomware campaign use: Known.", product_ids: ["CSAFPID-0003"], date: "2024-02-01T00:00:00.000Z" }]);
  assert.deepEqual(v.remediations, [{ category: "mitigation", details: "Patch it. CISA remediation due date (fix-by): 2024-02-22. This is a DEADLINE, not an availability date, and is stated here rather than in this remediation's `date` field, which CSAF defines as the date from which the remediation is AVAILABLE.", product_ids: ["CSAFPID-0003"] }]);
  assert.deepEqual(v.references, undefined);
});

test('without KEV or EPSS options the CSAF 2.1 document carries only the impact threat', () => {
  const r = buildAll(product, maker, roll({ state: 'persisting' }), [], none, at, {});
  const v = r.csaf21.vulnerabilities[0];
  assert.deepEqual(v.threats, undefined);
  assert.equal(v.remediations, undefined);
  assert.equal(v.references, undefined);
});
