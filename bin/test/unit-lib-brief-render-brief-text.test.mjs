// Renders a plain-text remediation brief (bin/lib/brief.mjs renderBriefText).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBriefText } from '../lib/brief.mjs';

const base = {
  counts: { repos: 2, actions: 1, kev: 1, issues: 1, suppressed: 0, notMeasured: 1 },
  generatedAt: '2025-01-01T00:00:00Z',
  enrichment: { kev: { consulted: true, catalogVersion: 'v1', freshness: 'fresh' }, epss: { scored: 1, of: 1 } },
  repos: [{ name: 'r1', depsMeasured: true }, { name: 'r2', depsMeasured: false }],
  actions: [{ repo: 'r1', package: 'pkg', version: '1.0.0', fix: '1.0.1', kev: 1, worst: 'crit', epss: 0.5, findings: [{ id: 'CVE-1', kev: true }] }],
  undetermined: [],
  issues: [{ repo: 'r1', label: 'secret', counts: { crit: 1, high: 0, med: 0, low: 0, undetermined: 0 }, top: [{ rule: 'R1', file: 'f.js', line: 10 }] }],
  notMeasured: [{ repo: 'r1', check: 'c1', kind: 'k1', reason: 'reason1' }]
};

test('renders plural repos and plural KEV advisors with one action', () => {
  const b = { ...base, counts: { ...base.counts, repos: 2, kev: 2 }, actions: [base.actions[0]] };
  const r = renderBriefText(b);
  assert.equal(r, "Remediation brief \u00b7 2 repos \u00b7 2025-01-01T00:00:00Z\nKEV catalogue v1 (fresh) \u00b7 EPSS for 1 of 1 advisories\n\n1. Dependency fixes, CVE/KEV first (1; 2 KEV advisories)\n   1) r1: pkg@1.0.0 \u2192 1.0.1  [KEV \u00d71 \u00b7 crit \u00b7 EPSS 0.50]\n      CVE-1 (KEV)\n   Dependency advisories were not measured in r2; see \"Not measured\".\n\n2. Other security findings (1 lane with open findings)\n   1) r1: secret  [crit 1]\n      e.g. R1 f.js:10\n\n3. Not measured (1): a lane that did not run is not a pass\n   r1: c1 (k1) reason1\n");
});

test('renders singular repo and singular KEV advisor with no actions', () => {
  const b = { ...base, counts: { ...base.counts, repos: 1, actions: 0, kev: 1 }, actions: [] };
  const r = renderBriefText(b);
  assert.equal(r, "Remediation brief \u00b7 1 repo \u00b7 2025-01-01T00:00:00Z\nKEV catalogue v1 (fresh) \u00b7 EPSS for 1 of 1 advisories\n\n1. Dependency fixes, CVE/KEV first (0; 1 KEV advisory)\n   none found where dependency advisories were measured\n   Dependency advisories were not measured in r2; see \"Not measured\".\n\n2. Other security findings (1 lane with open findings)\n   1) r1: secret  [crit 1]\n      e.g. R1 f.js:10\n\n3. Not measured (1): a lane that did not run is not a pass\n   r1: c1 (k1) reason1\n");
});

test('renders action numbering starting at one with default limit', () => {
  const b = { ...base, actions: [base.actions[0]] };
  const r = renderBriefText(b);
  assert.equal(r, "Remediation brief \u00b7 2 repos \u00b7 2025-01-01T00:00:00Z\nKEV catalogue v1 (fresh) \u00b7 EPSS for 1 of 1 advisories\n\n1. Dependency fixes, CVE/KEV first (1; 1 KEV advisory)\n   1) r1: pkg@1.0.0 \u2192 1.0.1  [KEV \u00d71 \u00b7 crit \u00b7 EPSS 0.50]\n      CVE-1 (KEV)\n   Dependency advisories were not measured in r2; see \"Not measured\".\n\n2. Other security findings (1 lane with open findings)\n   1) r1: secret  [crit 1]\n      e.g. R1 f.js:10\n\n3. Not measured (1): a lane that did not run is not a pass\n   r1: c1 (k1) reason1\n");
});

test('renders more-in-brief line when actions exceed limit', () => {
  const b = { ...base, counts: { ...base.counts, actions: 2 }, actions: [base.actions[0], { ...base.actions[0], package: 'pkg2' }] };
  const r = renderBriefText(b, { limit: 1 });
  assert.equal(r, "Remediation brief \u00b7 2 repos \u00b7 2025-01-01T00:00:00Z\nKEV catalogue v1 (fresh) \u00b7 EPSS for 1 of 1 advisories\n\n1. Dependency fixes, CVE/KEV first (2; 1 KEV advisory)\n   1) r1: pkg@1.0.0 \u2192 1.0.1  [KEV \u00d71 \u00b7 crit \u00b7 EPSS 0.50]\n      CVE-1 (KEV)\n   \u2026 1 more in brief.md\n   Dependency advisories were not measured in r2; see \"Not measured\".\n\n2. Other security findings (1 lane with open findings)\n   1) r1: secret  [crit 1]\n      e.g. R1 f.js:10\n\n3. Not measured (1): a lane that did not run is not a pass\n   r1: c1 (k1) reason1\n");
});

test('renders undetermined advisors plural when count is two', () => {
  const b = { ...base, undetermined: [{}, {}] };
  const r = renderBriefText(b);
  assert.equal(r, "Remediation brief \u00b7 2 repos \u00b7 2025-01-01T00:00:00Z\nKEV catalogue v1 (fresh) \u00b7 EPSS for 1 of 1 advisories\n\n1. Dependency fixes, CVE/KEV first (1; 1 KEV advisory)\n   1) r1: pkg@1.0.0 \u2192 1.0.1  [KEV \u00d71 \u00b7 crit \u00b7 EPSS 0.50]\n      CVE-1 (KEV)\n   2 advisories undetermined (version not declared, or not reachable); listed in brief.md, not counted\n   Dependency advisories were not measured in r2; see \"Not measured\".\n\n2. Other security findings (1 lane with open findings)\n   1) r1: secret  [crit 1]\n      e.g. R1 f.js:10\n\n3. Not measured (1): a lane that did not run is not a pass\n   r1: c1 (k1) reason1\n");
});

test('renders singular issue lane and singular undetermined advisor', () => {
  const b = { ...base, counts: { ...base.counts, issues: 1 }, undetermined: [{}] };
  const r = renderBriefText(b);
  assert.equal(r, "Remediation brief \u00b7 2 repos \u00b7 2025-01-01T00:00:00Z\nKEV catalogue v1 (fresh) \u00b7 EPSS for 1 of 1 advisories\n\n1. Dependency fixes, CVE/KEV first (1; 1 KEV advisory)\n   1) r1: pkg@1.0.0 \u2192 1.0.1  [KEV \u00d71 \u00b7 crit \u00b7 EPSS 0.50]\n      CVE-1 (KEV)\n   1 advisory undetermined (version not declared, or not reachable); listed in brief.md, not counted\n   Dependency advisories were not measured in r2; see \"Not measured\".\n\n2. Other security findings (1 lane with open findings)\n   1) r1: secret  [crit 1]\n      e.g. R1 f.js:10\n\n3. Not measured (1): a lane that did not run is not a pass\n   r1: c1 (k1) reason1\n");
});

test('renders issue numbering and top finding with file and line', () => {
  const b = { ...base, issues: [base.issues[0]] };
  const r = renderBriefText(b);
  assert.equal(r, "Remediation brief \u00b7 2 repos \u00b7 2025-01-01T00:00:00Z\nKEV catalogue v1 (fresh) \u00b7 EPSS for 1 of 1 advisories\n\n1. Dependency fixes, CVE/KEV first (1; 1 KEV advisory)\n   1) r1: pkg@1.0.0 \u2192 1.0.1  [KEV \u00d71 \u00b7 crit \u00b7 EPSS 0.50]\n      CVE-1 (KEV)\n   Dependency advisories were not measured in r2; see \"Not measured\".\n\n2. Other security findings (1 lane with open findings)\n   1) r1: secret  [crit 1]\n      e.g. R1 f.js:10\n\n3. Not measured (1): a lane that did not run is not a pass\n   r1: c1 (k1) reason1\n");
});

test('renders not-measured entries with default limit', () => {
  const b = { ...base, notMeasured: [base.notMeasured[0]] };
  const r = renderBriefText(b);
  assert.equal(r, "Remediation brief \u00b7 2 repos \u00b7 2025-01-01T00:00:00Z\nKEV catalogue v1 (fresh) \u00b7 EPSS for 1 of 1 advisories\n\n1. Dependency fixes, CVE/KEV first (1; 1 KEV advisory)\n   1) r1: pkg@1.0.0 \u2192 1.0.1  [KEV \u00d71 \u00b7 crit \u00b7 EPSS 0.50]\n      CVE-1 (KEV)\n   Dependency advisories were not measured in r2; see \"Not measured\".\n\n2. Other security findings (1 lane with open findings)\n   1) r1: secret  [crit 1]\n      e.g. R1 f.js:10\n\n3. Not measured (1): a lane that did not run is not a pass\n   r1: c1 (k1) reason1\n");
});
