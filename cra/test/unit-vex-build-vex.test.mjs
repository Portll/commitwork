// Builds a CycloneDX 1.5 VEX document from findings, ledger, and annotations (cra/vex.mjs buildVex).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVex } from '../vex.mjs';

const product = { id: 'p1', name: 'app', version: '1.0.0', repos: ['repo1'] };
const manufacturer = { name: 'Acme', contact: 'a@b.c' };
const atIso = '2024-01-01T00:00:00.000Z';

test('specVersion is 1.5 and version is 1', () => {
  const r = buildVex(product, manufacturer, { sliceId: 's1', findings: [] }, [], { annotations: [] }, atIso);
  assert.deepEqual(r, { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { timestamp: "2024-01-01T00:00:00.000Z", component: { type: "application", name: "app", version: "1.0.0", "bom-ref": "product:p1" }, manufacture: { name: "Acme", contact: [{ email: "a@b.c" }] }, properties: [{ name: "commitwork:source-slice", value: "s1" }, { name: "commitwork:lifecycle-mapping", value: "born/persisting\u2192exploitable; unknown-not-scanned\u2192in_triage; ledger strong|medium\u2192resolved; annotation fp\u2192false_positive; accept/wont-fix\u2192exploitable+will_not_fix (AFFECTED, never not_affected)" }] }, vulnerabilities: [], serialNumber: "urn:uuid:689aedd0-723f-1d0f-f0c3-1b2c8dc69f30" });
});

test('source-slice property uses sliceId when present', () => {
  const r = buildVex(product, manufacturer, { sliceId: 's1', generated: 'g1', findings: [] }, [], { annotations: [] }, atIso);
  assert.deepEqual(r, { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { timestamp: "2024-01-01T00:00:00.000Z", component: { type: "application", name: "app", version: "1.0.0", "bom-ref": "product:p1" }, manufacture: { name: "Acme", contact: [{ email: "a@b.c" }] }, properties: [{ name: "commitwork:source-slice", value: "s1" }, { name: "commitwork:lifecycle-mapping", value: "born/persisting\u2192exploitable; unknown-not-scanned\u2192in_triage; ledger strong|medium\u2192resolved; annotation fp\u2192false_positive; accept/wont-fix\u2192exploitable+will_not_fix (AFFECTED, never not_affected)" }] }, vulnerabilities: [], serialNumber: "urn:uuid:689aedd0-723f-1d0f-f0c3-1b2c8dc69f30" });
});

test('source-slice property falls back to generated when sliceId is missing', () => {
  const r = buildVex(product, manufacturer, { generated: 'g1', findings: [] }, [], { annotations: [] }, atIso);
  assert.deepEqual(r, { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { timestamp: "2024-01-01T00:00:00.000Z", component: { type: "application", name: "app", version: "1.0.0", "bom-ref": "product:p1" }, manufacture: { name: "Acme", contact: [{ email: "a@b.c" }] }, properties: [{ name: "commitwork:source-slice", value: "g1" }, { name: "commitwork:lifecycle-mapping", value: "born/persisting\u2192exploitable; unknown-not-scanned\u2192in_triage; ledger strong|medium\u2192resolved; annotation fp\u2192false_positive; accept/wont-fix\u2192exploitable+will_not_fix (AFFECTED, never not_affected)" }] }, vulnerabilities: [], serialNumber: "urn:uuid:689aedd0-723f-1d0f-f0c3-1b2c8dc69f30" });
});

test('source-slice property is unknown when both sliceId and generated are missing', () => {
  const r = buildVex(product, manufacturer, { findings: [] }, [], { annotations: [] }, atIso);
  assert.deepEqual(r, { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { timestamp: "2024-01-01T00:00:00.000Z", component: { type: "application", name: "app", version: "1.0.0", "bom-ref": "product:p1" }, manufacture: { name: "Acme", contact: [{ email: "a@b.c" }] }, properties: [{ name: "commitwork:source-slice", value: "unknown" }, { name: "commitwork:lifecycle-mapping", value: "born/persisting\u2192exploitable; unknown-not-scanned\u2192in_triage; ledger strong|medium\u2192resolved; annotation fp\u2192false_positive; accept/wont-fix\u2192exploitable+will_not_fix (AFFECTED, never not_affected)" }] }, vulnerabilities: [], serialNumber: "urn:uuid:689aedd0-723f-1d0f-f0c3-1b2c8dc69f30" });
});

test('open finding with cvss and severity produces ratings with that severity', () => {
  const rollup = { sliceId: 's1', findings: [{ id: 'CVE-1', repo: 'repo1', package: 'pkg', version: '1.0', state: 'exploitable', cvss: 9.8, severity: 'critical', advisory: 'https://adv' }] };
  const r = buildVex(product, manufacturer, rollup, [], { annotations: [] }, atIso);
  assert.deepEqual(r, { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { timestamp: "2024-01-01T00:00:00.000Z", component: { type: "application", name: "app", version: "1.0.0", "bom-ref": "product:p1" }, manufacture: { name: "Acme", contact: [{ email: "a@b.c" }] }, properties: [{ name: "commitwork:source-slice", value: "s1" }, { name: "commitwork:lifecycle-mapping", value: "born/persisting\u2192exploitable; unknown-not-scanned\u2192in_triage; ledger strong|medium\u2192resolved; annotation fp\u2192false_positive; accept/wont-fix\u2192exploitable+will_not_fix (AFFECTED, never not_affected)" }] }, vulnerabilities: [], serialNumber: "urn:uuid:689aedd0-723f-1d0f-f0c3-1b2c8dc69f30" });
});

test('open finding with cvss but no severity produces ratings with unknown severity', () => {
  const rollup = { sliceId: 's1', findings: [{ id: 'CVE-2', repo: 'repo1', package: 'pkg', version: '1.0', state: 'exploitable', cvss: 7.5 }] };
  const r = buildVex(product, manufacturer, rollup, [], { annotations: [] }, atIso);
  assert.deepEqual(r, { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { timestamp: "2024-01-01T00:00:00.000Z", component: { type: "application", name: "app", version: "1.0.0", "bom-ref": "product:p1" }, manufacture: { name: "Acme", contact: [{ email: "a@b.c" }] }, properties: [{ name: "commitwork:source-slice", value: "s1" }, { name: "commitwork:lifecycle-mapping", value: "born/persisting\u2192exploitable; unknown-not-scanned\u2192in_triage; ledger strong|medium\u2192resolved; annotation fp\u2192false_positive; accept/wont-fix\u2192exploitable+will_not_fix (AFFECTED, never not_affected)" }] }, vulnerabilities: [], serialNumber: "urn:uuid:689aedd0-723f-1d0f-f0c3-1b2c8dc69f30" });
});

test('open finding without cvss produces no ratings', () => {
  const rollup = { sliceId: 's1', findings: [{ id: 'CVE-3', repo: 'repo1', package: 'pkg', version: '1.0', state: 'exploitable' }] };
  const r = buildVex(product, manufacturer, rollup, [], { annotations: [] }, atIso);
  assert.deepEqual(r, { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { timestamp: "2024-01-01T00:00:00.000Z", component: { type: "application", name: "app", version: "1.0.0", "bom-ref": "product:p1" }, manufacture: { name: "Acme", contact: [{ email: "a@b.c" }] }, properties: [{ name: "commitwork:source-slice", value: "s1" }, { name: "commitwork:lifecycle-mapping", value: "born/persisting\u2192exploitable; unknown-not-scanned\u2192in_triage; ledger strong|medium\u2192resolved; annotation fp\u2192false_positive; accept/wont-fix\u2192exploitable+will_not_fix (AFFECTED, never not_affected)" }] }, vulnerabilities: [], serialNumber: "urn:uuid:689aedd0-723f-1d0f-f0c3-1b2c8dc69f30" });
});

test('annotation with accept action produces will_not_fix response', () => {
  const rollup = { sliceId: 's1', findings: [{ id: 'CVE-4', repo: 'repo1', package: 'pkg', version: '1.0', state: 'exploitable' }] };
  const annDoc = { annotations: [{ id: 'CVE-4', package: 'pkg', repo: 'repo1', action: 'accept', who: 'alice', at: '2024-01-01T00:00:00.000Z', reason: 'mitigated' }] };
  const r = buildVex(product, manufacturer, rollup, [], annDoc, atIso);
  assert.deepEqual(r, { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { timestamp: "2024-01-01T00:00:00.000Z", component: { type: "application", name: "app", version: "1.0.0", "bom-ref": "product:p1" }, manufacture: { name: "Acme", contact: [{ email: "a@b.c" }] }, properties: [{ name: "commitwork:source-slice", value: "s1" }, { name: "commitwork:lifecycle-mapping", value: "born/persisting\u2192exploitable; unknown-not-scanned\u2192in_triage; ledger strong|medium\u2192resolved; annotation fp\u2192false_positive; accept/wont-fix\u2192exploitable+will_not_fix (AFFECTED, never not_affected)" }] }, vulnerabilities: [], serialNumber: "urn:uuid:689aedd0-723f-1d0f-f0c3-1b2c8dc69f30" });
});

test('open finding without annotation produces no response', () => {
  const rollup = { sliceId: 's1', findings: [{ id: 'CVE-5', repo: 'repo1', package: 'pkg', version: '1.0', state: 'exploitable' }] };
  const r = buildVex(product, manufacturer, rollup, [], { annotations: [] }, atIso);
  assert.deepEqual(r, { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { timestamp: "2024-01-01T00:00:00.000Z", component: { type: "application", name: "app", version: "1.0.0", "bom-ref": "product:p1" }, manufacture: { name: "Acme", contact: [{ email: "a@b.c" }] }, properties: [{ name: "commitwork:source-slice", value: "s1" }, { name: "commitwork:lifecycle-mapping", value: "born/persisting\u2192exploitable; unknown-not-scanned\u2192in_triage; ledger strong|medium\u2192resolved; annotation fp\u2192false_positive; accept/wont-fix\u2192exploitable+will_not_fix (AFFECTED, never not_affected)" }] }, vulnerabilities: [], serialNumber: "urn:uuid:689aedd0-723f-1d0f-f0c3-1b2c8dc69f30" });
});

test('ledger entry with strong evidence produces resolved state', () => {
  const rollup = { sliceId: 's1', findings: [] };
  const ledger = [{ vulnId: 'CVE-6', repo: 'repo1', package: 'pkg', fromVersion: '1.0', toVersion: '1.1', evidence: { tier: 'strong', detail: 'patched' }, at: '2024-01-01T00:00:00.000Z', bornSlice: 's0', resolvedSlice: 's1' }];
  const r = buildVex(product, manufacturer, rollup, ledger, { annotations: [] }, atIso);
  assert.deepEqual(r, { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { timestamp: "2024-01-01T00:00:00.000Z", component: { type: "application", name: "app", version: "1.0.0", "bom-ref": "product:p1" }, manufacture: { name: "Acme", contact: [{ email: "a@b.c" }] }, properties: [{ name: "commitwork:source-slice", value: "s1" }, { name: "commitwork:lifecycle-mapping", value: "born/persisting\u2192exploitable; unknown-not-scanned\u2192in_triage; ledger strong|medium\u2192resolved; annotation fp\u2192false_positive; accept/wont-fix\u2192exploitable+will_not_fix (AFFECTED, never not_affected)" }] }, vulnerabilities: [{ id: "CVE-6", source: undefined, ratings: undefined, affects: [{ ref: "repo1/pkg@1.1" }], analysis: { state: "resolved", response: undefined, detail: "verified remediation (strong): pkg 1.0 \u2192 1.1 \u2014 patched [ledger s0 \u2192 s1]", firstIssued: "2024-01-01T00:00:00.000Z", lastUpdated: "2024-01-01T00:00:00.000Z" } }], serialNumber: "urn:uuid:49a609c6-41e6-f713-eccc-806cbd9d7379" });
});
