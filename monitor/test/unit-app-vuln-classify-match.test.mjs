// Computes a publish verdict and enriched match record from a vulnerability match (monitor/app-vuln.mjs classifyMatch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMatch } from '../app-vuln.mjs';

test('returns severity publish when match has exact-direct-match type and no kev or epss', () => {
  const m = { id: 'CVE-1', component: 'pkg', componentVersion: '1.0.0', matchTypes: ['exact-direct-match'], severity: 'high' };
  const r = classifyMatch(m, { kevSet: null, epss: null, osvIds: null });
  assert.deepEqual(r, { subject: "pkg@1.0.0|CVE-1", id: "CVE-1", component: "pkg", componentVersion: "1.0.0", matchTypes: ["exact-direct-match"], kev: null, epss: null, why: "tier-1 oracle (grype-ecosystem-exact) passed oracle-integrity \u2014 publishes alone, converges with nothing", publish: "severity", severity: "high" });
});

test('returns undetermined publish when match has no exact type and no osv id', () => {
  const m = { id: 'CVE-2', component: 'pkg', componentVersion: '2.0.0', matchTypes: ['fuzzy'], severity: 'medium' };
  const r = classifyMatch(m, { kevSet: null, epss: null, osvIds: null });
  assert.deepEqual(r, { subject: "pkg@2.0.0|CVE-2", id: "CVE-2", component: "pkg", componentVersion: "2.0.0", matchTypes: ["fuzzy"], kev: null, epss: null, why: "single inference lens (grype-cpe) \u2014 caps at undetermined (F's false-negative floor: a lone true finding is demoted, the price of specificity)", publish: "undetermined", originalClaim: { severity: "medium" } });
});

test('returns severity publish when match has indirect exact type', () => {
  const m = { id: 'CVE-3', component: 'lib', componentVersion: '3.1.0', matchTypes: ['exact-indirect'], severity: 'critical' };
  const r = classifyMatch(m, { kevSet: null, epss: null, osvIds: null });
  assert.deepEqual(r, { subject: "lib@3.1.0|CVE-3", id: "CVE-3", component: "lib", componentVersion: "3.1.0", matchTypes: ["exact-indirect"], kev: null, epss: null, why: "single tier-2 lens (grype-ecosystem-indirect) \u2014 caps at undetermined (F's false-negative floor: a lone true finding is demoted, the price of specificity)", publish: "undetermined", originalClaim: { severity: "critical" } });
});

test('returns undetermined publish when match has cpe type only', () => {
  const m = { id: 'CVE-4', component: 'tool', componentVersion: '0.9.0', matchTypes: ['cpe-match'], severity: 'low' };
  const r = classifyMatch(m, { kevSet: null, epss: null, osvIds: null });
  assert.deepEqual(r, { subject: "tool@0.9.0|CVE-4", id: "CVE-4", component: "tool", componentVersion: "0.9.0", matchTypes: ["cpe-match"], kev: null, epss: null, why: "single inference lens (grype-cpe) \u2014 caps at undetermined (F's false-negative floor: a lone true finding is demoted, the price of specificity)", publish: "undetermined", originalClaim: { severity: "low" } });
});

test('returns severity publish when match has empty matchTypes and osv id present', () => {
  const m = { id: 'CVE-5', component: 'app', componentVersion: '5.0.0', matchTypes: [], severity: 'high' };
  const osvIds = new Set(['CVE-5']);
  const r = classifyMatch(m, { kevSet: null, epss: null, osvIds });
  assert.deepEqual(r, { subject: "app@5.0.0|CVE-5", id: "CVE-5", component: "app", componentVersion: "5.0.0", matchTypes: [], kev: null, epss: null, why: "tier-1 oracle (osv-ecosystem) passed oracle-integrity \u2014 publishes alone, converges with nothing", publish: "severity", severity: "high" });
});

test('returns undetermined publish when match has empty matchTypes and no osv id', () => {
  const m = { id: 'CVE-6', component: 'app', componentVersion: '6.0.0', matchTypes: [], severity: 'medium' };
  const osvIds = new Set(['OTHER']);
  const r = classifyMatch(m, { kevSet: null, epss: null, osvIds });
  assert.deepEqual(r, { subject: "app@6.0.0|CVE-6", id: "CVE-6", component: "app", componentVersion: "6.0.0", matchTypes: [], kev: null, epss: null, why: "single inference lens (grype-cpe) \u2014 caps at undetermined (F's false-negative floor: a lone true finding is demoted, the price of specificity)", publish: "undetermined", originalClaim: { severity: "medium" } });
});

test('returns severity publish when match has exact-direct-match and kev set contains id', () => {
  const m = { id: 'CVE-7', component: 'pkg', componentVersion: '7.0.0', matchTypes: ['exact-direct-match'], severity: 'high' };
  const kevSet = new Set(['CVE-7']);
  const r = classifyMatch(m, { kevSet, epss: null, osvIds: null });
  assert.deepEqual(r, { subject: "pkg@7.0.0|CVE-7", id: "CVE-7", component: "pkg", componentVersion: "7.0.0", matchTypes: ["exact-direct-match"], kev: true, epss: null, why: "tier-1 oracle (grype-ecosystem-exact) passed oracle-integrity \u2014 publishes alone, converges with nothing", publish: "severity", severity: "high" });
});

test('returns undetermined publish when match has cpe type and kev set does not contain id', () => {
  const m = { id: 'CVE-8', component: 'pkg', componentVersion: '8.0.0', matchTypes: ['cpe-match'], severity: 'low' };
  const kevSet = new Set(['OTHER']);
  const r = classifyMatch(m, { kevSet, epss: null, osvIds: null });
  assert.deepEqual(r, { subject: "pkg@8.0.0|CVE-8", id: "CVE-8", component: "pkg", componentVersion: "8.0.0", matchTypes: ["cpe-match"], kev: false, epss: null, why: "single inference lens (grype-cpe) \u2014 caps at undetermined (F's false-negative floor: a lone true finding is demoted, the price of specificity)", publish: "undetermined", originalClaim: { severity: "low" } });
});

test('returns severity publish when match has exact-direct-match and epss object has id', () => {
  const m = { id: 'CVE-9', component: 'pkg', componentVersion: '9.0.0', matchTypes: ['exact-direct-match'], severity: 'high' };
  const epss = { 'CVE-9': 0.85 };
  const r = classifyMatch(m, { kevSet: null, epss, osvIds: null });
  assert.deepEqual(r, { subject: "pkg@9.0.0|CVE-9", id: "CVE-9", component: "pkg", componentVersion: "9.0.0", matchTypes: ["exact-direct-match"], kev: null, epss: 0.85, why: "tier-1 oracle (grype-ecosystem-exact) passed oracle-integrity \u2014 publishes alone, converges with nothing", publish: "severity", severity: "high" });
});

test('returns undetermined publish when match has cpe type and epss object lacks id', () => {
  const m = { id: 'CVE-10', component: 'pkg', componentVersion: '10.0.0', matchTypes: ['cpe-match'], severity: 'medium' };
  const epss = { 'OTHER': 0.1 };
  const r = classifyMatch(m, { kevSet: null, epss, osvIds: null });
  assert.deepEqual(r, { subject: "pkg@10.0.0|CVE-10", id: "CVE-10", component: "pkg", componentVersion: "10.0.0", matchTypes: ["cpe-match"], kev: null, epss: null, why: "single inference lens (grype-cpe) \u2014 caps at undetermined (F's false-negative floor: a lone true finding is demoted, the price of specificity)", publish: "undetermined", originalClaim: { severity: "medium" } });
});
