// Renders the remediation brief as a standalone HTML document (bin/lib/brief.mjs renderBriefHtml).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBriefHtml } from '../lib/brief.mjs';

const DOT = ' \u00b7 ';
const REPOS_HEAD = '<table><thead><tr><th>Repo</th><th>Path</th><th>Commit</th></tr></thead><tbody>';
const R1_ROW = '<tr><td>r1</td><td class="mono">p1</td><td class="mono">abc</td></tr>';
const NONE_FOUND = '<p>None found where dependency advisories were measured.</p>';
const H1 = '<h2>1. Dependency fixes, CVE/KEV first</h2>\n';
const chip = (s) => `<span class="sev s-${s}">${s}</span>`;
const sec = (r, from, to) => {
  const i = r.indexOf(from);
  return r.slice(i, r.indexOf(to, i));
};

const base = {
  counts: { repos: 1, suppressed: 0 },
  generatedAt: '2025-01-01T00:00:00Z',
  repos: [{ name: 'r1', path: 'p1', commit: 'abc', depsMeasured: true }],
  actions: [],
  undetermined: [],
  issues: [],
  notMeasured: [],
  enrichment: { kev: { consulted: true, catalogVersion: 'v1', freshness: 'fresh' }, epss: { scored: 1, of: 1 } }
};

test('an empty brief opens with the doctype and shows the empty state of every section', () => {
  const r = renderBriefHtml(base);
  const head = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">';
  assert.equal(r.slice(0, head.length), head);
  assert.equal(r.slice(r.indexOf('</style></head>')), [
    '</style></head><body><div class="b">',
    '<h1>Remediation brief</h1>',
    `<p class="stamp">1 repo${DOT}generated 2025-01-01T00:00:00Z${DOT}KEV catalogue v1 (fresh)${DOT}EPSS for 1 of 1 advisories</p>`,
    `${REPOS_HEAD}${R1_ROW}</tbody></table>`,
    '<h2>1. Dependency fixes, CVE/KEV first</h2>',
    NONE_FOUND,
    '<h2>2. Other security findings</h2>',
    '<p>None open.</p>',
    '<h2>3. Not measured</h2>',
    '<p class="note">A lane that did not run, or ran without seeing everything, is not a pass.</p>',
    '<p>Every in-scope lane ran.</p>',
    '</div></body></html>',
    ''
  ].join('\n'));
});

test('the stamp pluralises repos, reports an unconsulted KEV catalogue and blanks a missing commit', () => {
  const r = renderBriefHtml({
    ...base,
    counts: { repos: 2, suppressed: 0 },
    repos: [base.repos[0], { name: 'r2', path: 'p2', commit: null, depsMeasured: true }],
    enrichment: { kev: { consulted: false, reason: 'offline' }, epss: { scored: 0, of: 3 } }
  });
  assert.equal(sec(r, '<p class="stamp">', '<h2>1.'),
    `<p class="stamp">2 repos${DOT}generated 2025-01-01T00:00:00Z${DOT}KEV not consulted: offline${DOT}EPSS for 0 of 3 advisories</p>\n`
    + `${REPOS_HEAD}${R1_ROW}<tr><td>r2</td><td class="mono">p2</td><td class="mono"></td></tr></tbody></table>\n`);
});

test('dependency actions render as numbered rows with KEV highlighting, fix targets and EPSS scores', () => {
  const r = renderBriefHtml({
    ...base,
    actions: [
      { repo: 'r1', package: 'pkg', version: '1.0.0', fix: '1.0.1', kev: 2, worst: 'crit', epss: 0.5,
        findings: [{ id: 'CVE-1', kev: true, advisory: 'GHSA-1' }, { id: 'CVE-2', kev: false, advisory: 'GHSA-2' }] },
      { repo: 'r2', package: 'lib', version: '', fix: '', kev: 0, worst: 'low', epss: null,
        findings: [{ id: 'GHSA-3', kev: false, advisory: '' }] }
    ]
  });
  assert.equal(sec(r, '<h2>1.', '<h2>2.'), H1
    + '<table><thead><tr><th>#</th><th>Repo</th><th>Upgrade</th><th>KEV</th><th>Worst</th><th>EPSS</th><th>Advisories</th></tr></thead><tbody>'
    + `<tr class="kev"><td>1</td><td>r1</td><td class="mono">pkg@1.0.0 \u2192 1.0.1</td><td>2</td><td>${chip('crit')}</td><td>0.50</td>`
    + '<td class="mono">CVE-1 <strong>KEV</strong>, CVE-2</td></tr>'
    + `<tr><td>2</td><td>r2</td><td class="mono">lib (no fixed version published)</td><td></td><td>${chip('low')}</td><td></td>`
    + '<td class="mono">GHSA-3</td></tr></tbody></table>\n');
});

test('unmeasured repos add a dependency note and undetermined advisories get their own table', () => {
  const r = renderBriefHtml({
    ...base,
    repos: [base.repos[0], { name: 'r2', path: 'p2', commit: 'def', depsMeasured: false }, { name: 'r3', path: 'p3', commit: 'ghi', depsMeasured: false }],
    undetermined: [
      { repo: 'r2', id: 'CVE-9', package: 'zlib', version: '1.2', claimed: 'high', reason: 'no range' },
      { repo: 'r3', id: 'CVE-8', package: 'acorn', version: '', claimed: null, reason: 'unparsed' }
    ]
  });
  assert.equal(sec(r, '<h2>1.', '; see '),
    `${H1}${NONE_FOUND}<p class="note">Dependency advisories were not measured in r2, r3`);
  assert.equal(sec(r, '<h3>Undetermined', '<h2>2.'),
    '<h3>Undetermined (not counted)</h3><table><thead><tr><th>Repo</th><th>Advisory</th><th>Package</th><th>Claimed</th><th>Why</th></tr></thead><tbody>'
    + '<tr><td>r2</td><td class="mono">CVE-9</td><td class="mono">zlib@1.2</td><td>high</td><td>no range</td></tr>'
    + '<tr><td>r3</td><td class="mono">CVE-8</td><td class="mono">acorn</td><td></td><td>unparsed</td></tr></tbody></table>\n');
});

test('open issues list severity counts in fixed order and note findings beyond the top rows', () => {
  const r = renderBriefHtml({
    ...base,
    counts: { repos: 1, suppressed: 4 },
    issues: [
      { repo: 'r1', label: 'Semgrep', counts: { undetermined: 1, low: 1, crit: 0, high: 2 }, open: 3,
        top: [{ sev: 'high', rule: 'R1', file: 'a.js', line: 7, message: 'm1' }, { sev: 'low', rule: 'R2', file: 'b.js', line: 0, message: 'm2' }] },
      { repo: 'r2', label: 'Gitleaks', counts: { crit: 1 }, open: 1,
        top: [{ sev: 'crit', rule: 'R3', file: '', message: 'm3' }] }
    ]
  });
  assert.equal(sec(r, '<h2>2.', '<h2>3.'),
    '<h2>2. Other security findings</h2>\n<p class="note">4 suppressed in source, not listed.</p>'
    + `<div class="issue"><h3>r1: Semgrep ${chip('high')} 2 ${chip('low')} 1 ${chip('undetermined')} 1</h3><table><tbody>`
    + `<tr><td>${chip('high')}</td><td class="mono">R1</td><td class="mono">a.js:7</td><td>m1</td></tr>`
    + `<tr><td>${chip('low')}</td><td class="mono">R2</td><td class="mono">b.js</td><td>m2</td></tr>`
    + "</tbody></table><p class=\"note\">1 more in the lane's report.</p></div>"
    + `<div class="issue"><h3>r2: Gitleaks ${chip('crit')} 1</h3><table><tbody>`
    + `<tr><td>${chip('crit')}</td><td class="mono">R3</td><td class="mono"></td><td>m3</td></tr>`
    + '</tbody></table></div>\n');
});

test('lanes that did not run are listed in the not measured table', () => {
  const r = renderBriefHtml({
    ...base,
    notMeasured: [
      { repo: 'r1', check: 'osv', kind: 'deps', reason: 'no lockfile' },
      { repo: 'r2', check: 'semgrep', kind: 'sast', reason: 'timed out' }
    ]
  });
  assert.equal(sec(r, '<h2>3.', '</div></body>'),
    '<h2>3. Not measured</h2>\n<p class="note">A lane that did not run, or ran without seeing everything, is not a pass.</p>\n'
    + '<table><thead><tr><th>Repo</th><th>Check</th><th>Kind</th><th>Reason</th></tr></thead><tbody>'
    + '<tr><td>r1</td><td class="mono">osv</td><td>deps</td><td>no lockfile</td></tr>'
    + '<tr><td>r2</td><td class="mono">semgrep</td><td>sast</td><td>timed out</td></tr></tbody></table>\n');
});
