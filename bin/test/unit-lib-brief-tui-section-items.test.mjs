// Formats brief sections into TUI item lists (bin/lib/brief-tui.mjs sectionItems).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionItems } from '../lib/brief-tui.mjs';

test('fixes section maps actions with kev true and epss number', () => {
  const b = { actions: [{ worst: 'crit', kev: 2, epss: 0.123, repo: 'r', package: 'p', version: '1.0.0', fix: '1.0.1', path: 'm.json', findings: [{ severity: 'crit', id: 'CVE-1', cvss: 9.8, kev: true, epss: 0.5, malicious: false, title: 'T', advisory: 'A', fixed: '1.0.1', tool: 't' }] }] };
  assert.deepEqual(sectionItems(b, 'fixes'), [{ sev: "crit", kev: true, text: "KEV\u00d72 crit  EPSS 0.12  r  p@1.0.0 \u2192 1.0.1", detail: [{ text: "r: upgrade p@1.0.0 \u2192 1.0.1" }, { text: "declared in m.json" }, { text: "" }, { sev: "crit", text: "CVE-1  crit \u00b7 CVSS 9.8 \u00b7 KEV \u00b7 EPSS 0.50" }, { text: "  T" }, { text: "  A" }, { text: "  fixed in 1.0.1 \u00b7 reported by t" }] }]);
});

test('fixes section maps actions with kev zero and epss null', () => {
  const b = { actions: [{ worst: 'low', kev: 0, epss: null, repo: 'r', package: 'p', version: '1.0.0', fix: null, path: null, findings: [{ severity: 'low', id: 'CVE-2', cvss: null, kev: null, epss: null, malicious: true, title: null, advisory: null, fixed: null, tool: null }] }] };
  assert.deepEqual(sectionItems(b, 'fixes'), [{ sev: "low", kev: false, text: "      low              r  p@1.0.0 \u2192 no fixed version published", detail: [{ text: "r: upgrade p@1.0.0 \u2192 no fixed version published" }, { text: "declared in (no manifest path reported)" }, { text: "" }, { sev: "low", text: "CVE-2  low \u00b7 KEV not consulted \u00b7 MALICIOUS" }, { text: "  no fixed version \u00b7 reported by unknown tool" }] }]);
});

test('findings section maps issues with counts and top items', () => {
  const b = { issues: [{ worst: 'high', repo: 'r', label: 'L', check: 'c', kind: 'k', open: 5, suppressed: 0, truncated: 0, counts: { crit: 1, high: 2, med: 0, low: 1, undetermined: 0 }, top: [{ sev: 'high', rule: 'R', file: 'f.js', line: 10, message: 'M' }] }] };
  assert.deepEqual(sectionItems(b, 'findings'), [{ sev: "high", kev: false, text: "high         r: L  [crit 1 \u00b7 high 2 \u00b7 low 1]", detail: [{ text: "r: L (c, k)" }, { text: "5 open" }, { text: "" }, { sev: "high", text: "high         R  f.js:10" }, { text: "  M" }, { text: "" }, { text: "4 more in the lane's report." }] }]);
});

test('findings section handles suppressed and truncated with fewer top than open', () => {
  const b = { issues: [{ worst: 'med', repo: 'r', label: 'L', check: 'c', kind: 'k', open: 3, suppressed: 2, truncated: 1, counts: { crit: 0, high: 0, med: 1, low: 0, undetermined: 0 }, top: [{ sev: 'med', rule: 'R', file: null, line: null, message: null }] }] };
  assert.deepEqual(sectionItems(b, 'findings'), [{ sev: "med", kev: false, text: "med          r: L  [med 1]", detail: [{ text: "r: L (c, k)" }, { text: "3 open \u00b7 2 suppressed in source, not listed \u00b7 report truncated, 1 more" }, { text: "" }, { sev: "med", text: "med          R" }, { text: "" }, { text: "2 more in the lane's report." }] }]);
});

test('undetermined section maps entries with claimed severity', () => {
  const b = { undetermined: [{ repo: 'r', id: 'CVE-3', package: 'p', version: '1.0.0', claimed: 'high', reason: 'R' }] };
  assert.deepEqual(sectionItems(b, 'undetermined'), [{ sev: "undetermined", kev: false, text: "r  CVE-3  p@1.0.0  (claimed high)", detail: [{ text: "r: CVE-3 on p@1.0.0" }, { text: "the scanner claimed high; not counted in any severity" }, { text: "" }, { text: "R" }] }]);
});

test('undetermined section handles missing claimed and reason', () => {
  const b = { undetermined: [{ repo: 'r', id: 'CVE-4', package: 'p', version: null, claimed: null, reason: null }] };
  assert.deepEqual(sectionItems(b, 'undetermined'), [{ sev: "undetermined", kev: false, text: "r  CVE-4  p", detail: [{ text: "r: CVE-4 on p" }, { text: "the scanner claimed no severity; not counted in any severity" }, { text: "" }, { text: "no reason recorded" }] }]);
});

test('unmeasured section maps void kind', () => {
  const b = { notMeasured: [{ kind: 'void', repo: 'r', check: 'c', reason: 'R' }] };
  assert.deepEqual(sectionItems(b, 'unmeasured'), [{ sev: "undetermined", kev: false, text: "void     r: c", detail: [{ text: "r: c \u2014 did not run" }, { text: "A lane that did not run, or ran without seeing everything, is not a pass." }, { text: "" }, { text: "R" }] }]);
});

test('unmeasured section maps non-void kind with missing reason', () => {
  const b = { notMeasured: [{ kind: 'partial', repo: 'r', check: 'c', reason: null }] };
  assert.deepEqual(sectionItems(b, 'unmeasured'), [{ sev: "undetermined", kev: false, text: "partial  r: c", detail: [{ text: "r: c \u2014 ran without seeing everything" }, { text: "A lane that did not run, or ran without seeing everything, is not a pass." }, { text: "" }, { text: "no reason recorded" }] }]);
});

test('unknown key throws error', () => {
  assert.throws(() => sectionItems({}, 'bogus'), { name: 'Error', message: 'unknown brief section: bogus' });
});
