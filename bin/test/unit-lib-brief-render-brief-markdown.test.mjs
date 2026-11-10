// Renders a remediation brief as a markdown string (bin/lib/brief.mjs renderBriefMarkdown).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBriefMarkdown } from '../lib/brief.mjs';

const base = {
  counts: { repos: 1, suppressed: 0 },
  generatedAt: '2024-01-01',
  repos: [{ name: 'r1', path: 'p1', commit: 'c1', depsMeasured: true }],
  actions: [],
  undetermined: [],
  issues: [],
  notMeasured: [],
  enrichment: { kev: { consulted: true, catalogVersion: 'v1', freshness: 'fresh' }, epss: { scored: 1, of: 1 } }
};

test('renders singular repo count with one repository', () => {
  const r = renderBriefMarkdown(base);
  assert.equal(r, "# Remediation brief\n\n1 repo \u00b7 generated 2024-01-01 \u00b7 KEV catalogue v1 (fresh) \u00b7 EPSS for 1 of 1 advisories\n\n| Repo | Path | Commit |\n|---|---|---|\n| r1 | p1 | c1 |\n\n## 1. Dependency fixes, CVE/KEV first\n\nNone found where dependency advisories were measured.\n\n## 2. Other security findings\n\nNone open.\n\n## 3. Not measured\n\nA lane that did not run, or ran without seeing everything, is not a pass.\n\nEvery in-scope lane ran.\n");
});

test('renders plural repo count with two repositories', () => {
  const b = { ...base, counts: { ...base.counts, repos: 2 }, repos: [base.repos[0], { name: 'r2', path: 'p2', commit: 'c2', depsMeasured: true }] };
  const r = renderBriefMarkdown(b);
  assert.equal(r, "# Remediation brief\n\n2 repos \u00b7 generated 2024-01-01 \u00b7 KEV catalogue v1 (fresh) \u00b7 EPSS for 1 of 1 advisories\n\n| Repo | Path | Commit |\n|---|---|---|\n| r1 | p1 | c1 |\n| r2 | p2 | c2 |\n\n## 1. Dependency fixes, CVE/KEV first\n\nNone found where dependency advisories were measured.\n\n## 2. Other security findings\n\nNone open.\n\n## 3. Not measured\n\nA lane that did not run, or ran without seeing everything, is not a pass.\n\nEvery in-scope lane ran.\n");
});

test('renders empty actions section when no actions exist', () => {
  const r = renderBriefMarkdown(base);
  assert.equal(r, "# Remediation brief\n\n1 repo \u00b7 generated 2024-01-01 \u00b7 KEV catalogue v1 (fresh) \u00b7 EPSS for 1 of 1 advisories\n\n| Repo | Path | Commit |\n|---|---|---|\n| r1 | p1 | c1 |\n\n## 1. Dependency fixes, CVE/KEV first\n\nNone found where dependency advisories were measured.\n\n## 2. Other security findings\n\nNone open.\n\n## 3. Not measured\n\nA lane that did not run, or ran without seeing everything, is not a pass.\n\nEvery in-scope lane ran.\n");
});

test('renders action table with one action and kev present', () => {
  const b = { ...base, actions: [{ repo: 'r1', package: 'pkg', version: '1.0.0', fix: '1.0.1', kev: 1, worst: 'crit', epss: 0.5, findings: [{ id: 'CVE-1', kev: true }] }] };
  const r = renderBriefMarkdown(b);
  assert.equal(r, "# Remediation brief\n\n1 repo \u00b7 generated 2024-01-01 \u00b7 KEV catalogue v1 (fresh) \u00b7 EPSS for 1 of 1 advisories\n\n| Repo | Path | Commit |\n|---|---|---|\n| r1 | p1 | c1 |\n\n## 1. Dependency fixes, CVE/KEV first\n\n| # | Repo | Upgrade | KEV | Worst | EPSS | Advisories |\n|---|---|---|---|---|---|---|\n| 1 | r1 | pkg@1.0.0 \u2192 1.0.1 | 1 | crit | 0.50 | CVE-1 (KEV) |\n\n## 2. Other security findings\n\nNone open.\n\n## 3. Not measured\n\nA lane that did not run, or ran without seeing everything, is not a pass.\n\nEvery in-scope lane ran.\n");
});

test('renders action table with two actions and no kev', () => {
  const b = { ...base, actions: [
    { repo: 'r1', package: 'pkg1', version: '1.0.0', fix: '1.0.1', kev: 0, worst: 'high', epss: null, findings: [{ id: 'CVE-1', kev: false }] },
    { repo: 'r1', package: 'pkg2', version: '2.0.0', fix: '2.0.1', kev: 0, worst: 'med', epss: 0.1, findings: [{ id: 'CVE-2', kev: false }] }
  ] };
  const r = renderBriefMarkdown(b);
  assert.equal(r, "# Remediation brief\n\n1 repo \u00b7 generated 2024-01-01 \u00b7 KEV catalogue v1 (fresh) \u00b7 EPSS for 1 of 1 advisories\n\n| Repo | Path | Commit |\n|---|---|---|\n| r1 | p1 | c1 |\n\n## 1. Dependency fixes, CVE/KEV first\n\n| # | Repo | Upgrade | KEV | Worst | EPSS | Advisories |\n|---|---|---|---|---|---|---|\n| 1 | r1 | pkg1@1.0.0 \u2192 1.0.1 |  | high |  | CVE-1 |\n| 2 | r1 | pkg2@2.0.0 \u2192 2.0.1 |  | med | 0.10 | CVE-2 |\n\n## 2. Other security findings\n\nNone open.\n\n## 3. Not measured\n\nA lane that did not run, or ran without seeing everything, is not a pass.\n\nEvery in-scope lane ran.\n");
});

test('renders singular suppressed count with one finding', () => {
  const b = { ...base, counts: { ...base.counts, suppressed: 1 } };
  const r = renderBriefMarkdown(b);
  assert.equal(r, "# Remediation brief\n\n1 repo \u00b7 generated 2024-01-01 \u00b7 KEV catalogue v1 (fresh) \u00b7 EPSS for 1 of 1 advisories\n\n| Repo | Path | Commit |\n|---|---|---|\n| r1 | p1 | c1 |\n\n## 1. Dependency fixes, CVE/KEV first\n\nNone found where dependency advisories were measured.\n\n## 2. Other security findings\n\n1 finding is suppressed in source and not listed.\n\nNone open.\n\n## 3. Not measured\n\nA lane that did not run, or ran without seeing everything, is not a pass.\n\nEvery in-scope lane ran.\n");
});

test('renders plural suppressed count with two findings', () => {
  const b = { ...base, counts: { ...base.counts, suppressed: 2 } };
  const r = renderBriefMarkdown(b);
  assert.equal(r, "# Remediation brief\n\n1 repo \u00b7 generated 2024-01-01 \u00b7 KEV catalogue v1 (fresh) \u00b7 EPSS for 1 of 1 advisories\n\n| Repo | Path | Commit |\n|---|---|---|\n| r1 | p1 | c1 |\n\n## 1. Dependency fixes, CVE/KEV first\n\nNone found where dependency advisories were measured.\n\n## 2. Other security findings\n\n2 findings are suppressed in source and not listed.\n\nNone open.\n\n## 3. Not measured\n\nA lane that did not run, or ran without seeing everything, is not a pass.\n\nEvery in-scope lane ran.\n");
});

test('renders empty issues section when no issues exist', () => {
  const r = renderBriefMarkdown(base);
  assert.equal(r, "# Remediation brief\n\n1 repo \u00b7 generated 2024-01-01 \u00b7 KEV catalogue v1 (fresh) \u00b7 EPSS for 1 of 1 advisories\n\n| Repo | Path | Commit |\n|---|---|---|\n| r1 | p1 | c1 |\n\n## 1. Dependency fixes, CVE/KEV first\n\nNone found where dependency advisories were measured.\n\n## 2. Other security findings\n\nNone open.\n\n## 3. Not measured\n\nA lane that did not run, or ran without seeing everything, is not a pass.\n\nEvery in-scope lane ran.\n");
});

test('renders issue section with open count equal to top length', () => {
  const b = { ...base, issues: [{ repo: 'r1', label: 'scan', counts: { crit: 1, high: 0, med: 0, low: 0, undetermined: 0 }, open: 1, top: [{ sev: 'crit', rule: 'rule1', file: 'f1', line: 1, message: 'msg1' }] }] };
  const r = renderBriefMarkdown(b);
  assert.equal(r, "# Remediation brief\n\n1 repo \u00b7 generated 2024-01-01 \u00b7 KEV catalogue v1 (fresh) \u00b7 EPSS for 1 of 1 advisories\n\n| Repo | Path | Commit |\n|---|---|---|\n| r1 | p1 | c1 |\n\n## 1. Dependency fixes, CVE/KEV first\n\nNone found where dependency advisories were measured.\n\n## 2. Other security findings\n\n### r1: scan (crit 1)\n\n| Severity | Rule | Location | Message |\n|---|---|---|---|\n| crit | rule1 | f1:1 | msg1 |\n\n## 3. Not measured\n\nA lane that did not run, or ran without seeing everything, is not a pass.\n\nEvery in-scope lane ran.\n");
});

test('renders issue section with open count greater than top length', () => {
  const b = { ...base, issues: [{ repo: 'r1', label: 'scan', counts: { crit: 2, high: 0, med: 0, low: 0, undetermined: 0 }, open: 2, top: [{ sev: 'crit', rule: 'rule1', file: 'f1', line: 1, message: 'msg1' }] }] };
  const r = renderBriefMarkdown(b);
  assert.equal(r, "# Remediation brief\n\n1 repo \u00b7 generated 2024-01-01 \u00b7 KEV catalogue v1 (fresh) \u00b7 EPSS for 1 of 1 advisories\n\n| Repo | Path | Commit |\n|---|---|---|\n| r1 | p1 | c1 |\n\n## 1. Dependency fixes, CVE/KEV first\n\nNone found where dependency advisories were measured.\n\n## 2. Other security findings\n\n### r1: scan (crit 2)\n\n| Severity | Rule | Location | Message |\n|---|---|---|---|\n| crit | rule1 | f1:1 | msg1 |\n\n1 more in the lane's report.\n\n## 3. Not measured\n\nA lane that did not run, or ran without seeing everything, is not a pass.\n\nEvery in-scope lane ran.\n");
});
