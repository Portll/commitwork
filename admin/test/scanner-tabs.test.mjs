// Coverage honesty for the three scanner-detail tabs (REMEDIATION-scanner-tabs-2026-08-01 §4).
//
// These tabs promise DETAIL, which makes a false clean worse here than anywhere else in the panel:
// an empty grid under a heading that says "findings" reads as "we looked and it was clean" even
// when nothing scanned. Every state below exists to stop that reading.
//
// renderScannerTabs() lives inline in admin/index.html, so it is lifted from source and run against
// a minimal DOM shim — the same extraction technique as ansi-console.test.mjs and, in monitor/,
// socket-alerts.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelSchema } from '../../monitor/detail-schema.mjs';
import { panelSource } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = panelSource('index.html');

const escLine = SRC.split('\n').find((l) => l.startsWith('const esc='));
const ageAt = SRC.indexOf('const age=(iso)=>');
const rowAt = SRC.indexOf('const DETAIL_CELL=');
const tabsAt = SRC.indexOf('const SCANNER_TABS=[');
const fnAt = SRC.indexOf('function renderScannerTabs(d){');
assert.ok(escLine && ageAt > -1 && rowAt > -1 && tabsAt > -1 && fnAt > -1, 'the renderer block was not found in admin/index.html');
const ageSrc = SRC.slice(ageAt, SRC.indexOf(';\n', SRC.indexOf("'d old'", ageAt)) + 1);
const block = SRC.slice(rowAt, SRC.indexOf('\n}', fnAt) + 2);

// The shim records what the renderer wrote; nothing here emulates a browser beyond that.
// sevPill is defined further down index.html (outside the lifted block), so it is stubbed — these
// tests assert coverage-state honesty, not pill markup.
function harness() {
  const els = {}, badges = {};
  const el = (id) => (els[id] ||= { id, innerHTML: '', textContent: '' });
  const $ = (id) => el(id);
  const setTabN = (view, n) => { badges[view] = n; };
  const sevPill = (s) => `<span class="pill">${s}</span>`;
  // curView decides which lane owns the shared generic container; the renderer reads it
  // defensively, and the harness supplies it so a generic lane can be exercised at all.
  // nosemgrep: javascript.browser.security.eval-detected.eval-detected -- test harness evaluating an esc() helper extracted from panel source under test, no external input
  const renderScannerTabs = new Function('$', 'setTabN', 'esc', 'sevPill', 'curView', `${ageSrc}\n${block}\nreturn renderScannerTabs;`)($, setTabN, eval(`(${escLine.slice(escLine.indexOf('=') + 1).replace(/;$/, '')})`), sevPill, 'overview');
  // Detail cells are DERIVED from detailSchema now — the literal per-lane renderers are retired —
  // so the harness supplies the real schema by default, exactly as the server does. A test that
  // wants the schema-absent path passes `detailSchema: null` explicitly and gets the fail-closed
  // state, which is a thing worth asserting rather than a thing to stumble into.
  const SCHEMA = panelSchema();
  const render = (d) => renderScannerTabs({ detailSchema: SCHEMA, ...d });
  return { render, el, badges };
}

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const rows = (n) => Array.from({ length: n }, (_, i) => ({ repo: 'clientD', rule: 'r', file: `f${i}.js`, line: i, commit: 'abc' }));

test('VOID renders the void INSTEAD of an empty findings table', () => {
  const h = harness();
  h.render({ scanners: { secrets: { total: 0, ran: 0, skipped: 4, noscan: 2 } }, scannerFindings: { secrets: [] } });
  assert.match(h.el('sec-cov').innerHTML, /VOID — no trustworthy output/);
  assert.match(h.el('sec-cov').innerHTML, /coverage void, not a clean result/);
  assert.match(h.el('sec-rows').innerHTML, /nothing scanned/);
  assert.ok(!/class="pill live"/.test(h.el('sec-rows').innerHTML), 'a void must never render a clean pill');
  assert.equal(h.el('sec-n').textContent, 'no scan');
  assert.equal(h.badges.secrets, null, 'a void tab must carry no count badge — 0 would read as clean');
});

// ── ran===0 IS THREE FACTS ───────────────────────────────────────────────────────────────────────
// These four cases are the whole reason the single VOID pill was split. On clientD, "no JVM build
// here" and "BOLA was never given a URL" rendered identically, so five rows an operator could have
// fixed looked exactly like the two nothing could. The counts cannot separate them — only the skip
// REASON can, which is why rollup.mjs classifies and ships naSkips/blockedSkips.

test('every in-scope repo declaring the check inapplicable is N/A, not a coverage gap', () => {
  const h = harness();
  h.render({ scanners: { secrets: { total: 0, ran: 0, skipped: 3, noscan: 0, naSkips: 3, blockedSkips: 0,
    skipReason: 'n/a — none of go.mod present' } }, scannerFindings: { secrets: [] } });
  const cov = h.el('sec-cov').innerHTML;
  assert.match(cov, /N\/A — no target here/);
  assert.match(cov, /A correct exclusion, not a coverage gap/, 'n/a must be stated as an exclusion, never counted as a gap');
  assert.match(cov, /n\/a — none of go\.mod present/, 'the reason is shown, so the reader can check the claim');
  assert.equal(h.el('sec-n').textContent, 'n/a', '"no scan" overstates a category that was never going to produce one');
  assert.ok(!/class="pill live"/.test(h.el('sec-rows').innerHTML), 'n/a is still not clean — nothing was examined');
});

test('a check denied its input is UNRUN — the actionable state, never n/a', () => {
  const h = harness();
  h.render({ scanners: { secrets: { total: 0, ran: 0, skipped: 2, noscan: 0, naSkips: 0, blockedSkips: 2,
    skipReason: 'runtime scanner — no live URL (set --url / CW_TARGET_URL)' } }, scannerFindings: { secrets: [] } });
  const cov = h.el('sec-cov').innerHTML;
  assert.match(cov, /UNRUN — input missing/);
  assert.match(cov, /not a clean result/);
  assert.match(cov, /no live URL/, 'the operator is told what to supply');
  assert.doesNotMatch(cov, /N\/A/, 'a check that applies here must never read as inapplicable');
});

test('when both kinds of skip are present the BLOCKED one wins', () => {
  const h = harness();
  h.render({ scanners: { secrets: { total: 0, ran: 0, skipped: 5, noscan: 0, naSkips: 4, blockedSkips: 1,
    skipReason: 'runtime scanner — no live URL (set --url / CW_TARGET_URL)' } }, scannerFindings: { secrets: [] } });
  assert.match(h.el('sec-cov').innerHTML, /UNRUN — input missing/,
    'one repo that needed a URL is not cancelled out by four that had nothing to scan');
});

test('a rollup written before the split is UNRUN, never N/A — it may overstate a gap, never invent an exclusion', () => {
  const h = harness();
  h.render({ scanners: { secrets: { total: 0, ran: 0, skipped: 3, noscan: 0 } }, scannerFindings: { secrets: [] } });
  const cov = h.el('sec-cov').innerHTML;
  assert.match(cov, /UNRUN — input missing/);
  assert.doesNotMatch(cov, /N\/A/,
    'absent evidence must not be read as "correctly excluded" — that is the lie the whole section exists to refuse');
});

test('carried renders the banner and keeps the rows, naming the slice they belong to', () => {
  const h = harness();
  h.render({
    scanners: { secrets: { total: 3, ran: 2, skipped: 0, noscan: 0, carried: true, carriedFrom: 'sweep-20260731', carriedAt: iso(9e7) } },
    scannerFindings: { secrets: rows(3) },
  });
  assert.match(h.el('sec-cov').innerHTML, /carried · as of/);
  assert.match(h.el('sec-cov').innerHTML, /sweep-20260731/);
  assert.equal((h.el('sec-rows').innerHTML.match(/<tr>/g) || []).length, 3, 'carried must not empty the table');
});

test('truncated states the true total rather than implying the shown rows are all', () => {
  // The shortfall must be ATTRIBUTED, not merely stated: this asserts the cap case specifically,
  // which is why the rollup's `detail` block is present. A shortfall with no attribution used to
  // borrow this same sentence and is now its own state — see the four tests at the end of the file.
  const h = harness();
  h.render({ scanners: { secrets: { total: 143, ran: 2, skipped: 0, noscan: 0, detail: { rows: 3, truncated: 140, noDetail: [] } } }, scannerFindings: { secrets: rows(3) } });
  assert.match(h.el('sec-cov').innerHTML, /showing 3 of 143/);
  assert.match(h.el('sec-cov').innerHTML, /count is never capped/);
  assert.equal(h.badges.secrets, 143, 'the badge carries the true total, not the rendered row count');
});

test('partial says the rows are a floor', () => {
  const h = harness();
  h.render({ scanners: { secrets: { total: 2, ran: 1, skipped: 1, noscan: 1 } }, scannerFindings: { secrets: rows(2) } });
  assert.match(h.el('sec-cov').innerHTML, /partial · 1 noscan/);
  assert.match(h.el('sec-cov').innerHTML, /FLOOR, not a total/);
});

test('a genuinely clean category says clean, and only when something actually ran', () => {
  const h = harness();
  h.render({ scanners: { secrets: { total: 0, ran: 3, skipped: 0, noscan: 0 } }, scannerFindings: { secrets: [] } });
  assert.match(h.el('sec-rows').innerHTML, /class="pill live"/);
  assert.match(h.el('sec-rows').innerHTML, /3 repo\(s\) scanned, nothing found/);
  assert.equal(h.el('sec-cov').innerHTML, '', 'a clean full-coverage scan needs no banner');
});

test('a category absent from the rollup is ABSENT, not void and not clean', () => {
  const h = harness();
  h.render({ scanners: {}, scannerFindings: {} });
  assert.match(h.el('sec-cov').innerHTML, /No result — never scanned here/);
  assert.match(h.el('sec-cov').innerHTML, /no record of this check, either way/);
  assert.doesNotMatch(h.el('sec-cov').innerHTML, /nothing found/, 'a check with no record must never read as a clean one');
  assert.equal(h.badges.secrets, null);
});

test('counts present but detail missing is stated, not rendered as no findings', () => {
  const h = harness();
  h.render({ scanners: { secrets: { total: 88, ran: 1, skipped: 0, noscan: 0 } }, scannerFindings: {} });
  assert.match(h.el('sec-rows').innerHTML, /counts but no per-finding detail/);
  assert.equal(h.badges.secrets, 88);
});

test('all three tabs are driven, each from its own category', () => {
  const h = harness();
  h.render({
    scanners: { secrets: { total: 1, ran: 1, skipped: 0, noscan: 0 },
      maliciousPackages: { total: 1, ran: 1, skipped: 0, noscan: 0 },
      supplyChainHeuristic: { total: 1, ran: 1, skipped: 0, noscan: 0 } },
    scannerFindings: {
      secrets: [{ repo: 'a', rule: 'aws', file: 'x.js', line: 1, commit: 'deadbeefcafe' }],
      maliciousPackages: [{ repo: 'b', id: 'MAL-2025-47', package: '@ctrl/tinycolor', version: '4.1.1', ecosystem: 'npm', advisory: 'https://osv.dev/vulnerability/MAL-2025-47' }],
      supplyChainHeuristic: [{ repo: 'c', rule: 'typosquatting', package: 'expresss', version: '4.1.0', message: 'resembles express' }],
    },
  });
  assert.match(h.el('sec-rows').innerHTML, /aws/);
  assert.match(h.el('mal-rows').innerHTML, /MAL-2025-47/);
  assert.match(h.el('gd-rows').innerHTML, /typosquatting/);
  // The three driven lanes carry their own counts...
  const driven = { secrets: 1, malware: 1, supplychain: 1 };
  for (const [view, n] of Object.entries(driven)) assert.equal(h.badges[view], n, `${view} should show its own category's count`);
  // ...and every OTHER lane is CLEARED (null), never zero — a tab whose categories are all absent
  // must not render like a measured clean.
  //
  // Asserted by iteration rather than a deepEqual over the whole badge map: enumerating every lane
  // made this test fail whenever a lane was ADDED, which is a correct change failing a test for
  // reasons unrelated to what the test is named for. The invariant is "absent ⇒ null", not "these
  // eight lanes exist".
  for (const [view, v] of Object.entries(h.badges)) {
    if (view in driven) continue;
    assert.equal(v, null, `${view} has no category in this payload, so its badge must be cleared, not ${v}`);
  }
});

test('the Actions tab is driven from actionsPosture, and states its coverage like every other', () => {
  // zizmor's rows are SARIF-shaped, so the risk is not the renderer but the WIRING: a tab added to
  // the markup and left out of SCANNER_TABS renders an empty table forever, which is the "0 rows
  // reads as clean" shape this whole file exists to refuse.
  const h = harness();
  h.render({
    scanners: { actionsPosture: { total: 2, crit: 0, high: 1, med: 1, low: 0, ran: 1, skipped: 0, noscan: 0 } },
    scannerFindings: { actionsPosture: [
      { repo: 'memory-layer', rule: 'zizmor/template-injection', sev: 'high', file: '.github/workflows/ci.yml', line: 42, message: 'code injection via ${{ github.event.issue.title }}' },
      { repo: 'memory-layer', rule: 'zizmor/excessive-permissions', sev: 'med', file: '.github/workflows/ci.yml', line: 1, message: 'overly broad permissions' },
    ] },
  });
  const html = h.el('za-rows').innerHTML;
  assert.match(html, /zizmor\/template-injection/, 'the Actions tab must render its own category');
  assert.match(html, /ci\.yml:42/, 'with the workflow location, as the other SARIF tabs do');
  assert.equal(h.badges.actions, 2, 'and drive its nav badge from the category total');
});

test('a VOID Actions category renders the void, not an empty workflow table', () => {
  const h = harness();
  // No naSkips/blockedSkips: the pre-split rollup shape, which lands on UNRUN by design. zizmor is
  // offline and needs no token, so a skip here is never "n/a" — see the SCANNER_SPECS note.
  h.render({ scanners: { actionsPosture: { total: 0, ran: 0, skipped: 3, noscan: 0 } }, scannerFindings: {} });
  assert.match(h.el('za-cov').innerHTML, /UNRUN — input missing/, 'zizmor never having run is not a clean CI configuration');
  // the body is not left blank either: it states WHY there are no rows, so an empty grid can never
  // be read as "we looked at the workflows and they were fine"
  assert.match(h.el('za-rows').innerHTML, /nothing scanned/, 'the table says why it is empty');
  assert.equal(h.badges.actions, null, 'and the nav badge is CLEARED, never a fabricated zero');
});

// Scanner output reaches innerHTML here exactly as it does in the live console. A rule id or a
// GuardDog message is attacker-influenced text: it comes from a package's own metadata.
test('finding text is escaped — a hostile package name cannot inject markup', () => {
  const h = harness();
  h.render({
    scanners: { supplyChainHeuristic: { total: 1, ran: 1, skipped: 0, noscan: 0 } },
    scannerFindings: { supplyChainHeuristic: [{ repo: 'r', rule: 'x', package: '<img src=x onerror=alert(1)>', version: '1', message: '<script>bad()</script>' }] },
  });
  const html = h.el('gd-rows').innerHTML;
  assert.ok(!html.includes('<img'), `unescaped markup reached the table: ${html}`);
  assert.ok(!html.includes('<script>'), 'unescaped script tag reached the table');
  assert.ok(html.includes('&lt;img'), 'the hostile text should still be visible, escaped');
});

// ── scan scope ───────────────────────────────────────────────────────────────────────────────
// A config file took 859 findings out of one project's view in a single commit. The count that
// remained was true; on its own it was not the whole statement. These assert that the bound is
// visible on the same card as the coverage, and — the part that is easy to lose — that a scope
// which could not be determined never renders as a scan with no blind spots.

const SCOPE = {
  known: true, source: 'manifests/gitleaks.toml', maxTargetMB: 50,
  blocks: [
    { description: 'runtime data and build output', paths: ['(^|/)node_modules/', '\\.mdb$'], targetRules: null },
    { description: 'bibliographic caches', paths: ['(^|/)_meta_cache/'], targetRules: ['generic-api-key'] },
  ],
};

test('the Secrets tab states what the scan was not allowed to see', () => {
  const h = harness();
  h.render({ scanners: { secrets: { total: 9, ran: 1, skipped: 0, noscan: 0 } }, scannerFindings: { secrets: rows(9) }, scanScopes: { secrets: SCOPE } });
  const cov = h.el('sec-cov').innerHTML;
  assert.match(cov, /scope bounded/);
  assert.match(cov, /<b>2<\/b> path pattern\(s\) excluded from every rule/);
  assert.match(cov, /files over <b>50 MB<\/b> skipped whole/);
  assert.match(cov, /manifests\/gitleaks\.toml/, 'the disclosure must name its own source');
  assert.match(cov, /has not looked everywhere/);
});

test('a rule-scoped suppression is never flattened into a blanket exclusion', () => {
  // "not scanned at all" and "scanned by every rule but one" are different claims, and the
  // difference is the entire reason the _meta_cache suppression was safe to take.
  const h = harness();
  h.render({ scanners: { secrets: { total: 9, ran: 1, skipped: 0, noscan: 0 } }, scannerFindings: { secrets: rows(9) }, scanScopes: { secrets: SCOPE } });
  const cov = h.el('sec-cov').innerHTML;
  assert.match(cov, /only <code>generic-api-key<\/code> silenced/);
  assert.match(cov, /every other rule still runs on these files/);
  assert.match(cov, /these paths are not scanned at all/);
});

test('the scope shows on a CLEAN tab too — that is where it matters most', () => {
  const h = harness();
  h.render({ scanners: { secrets: { total: 0, ran: 3, skipped: 0, noscan: 0 } }, scannerFindings: { secrets: [] }, scanScopes: { secrets: SCOPE } });
  assert.match(h.el('sec-rows').innerHTML, /clean/);
  assert.match(h.el('sec-cov').innerHTML, /scope bounded/, 'a clean result with an undisclosed bound is the false clean this closes');
});

test('an undeterminable scope says UNKNOWN — never "nothing was excluded"', () => {
  const h = harness();
  h.render({ scanners: { secrets: { total: 2, ran: 1, skipped: 0, noscan: 0 } }, scannerFindings: { secrets: rows(2) },
    scanScopes: { secrets: { known: false, reason: 'unreadable', source: 'manifests/gitleaks.toml' } } });
  const cov = h.el('sec-cov').innerHTML;
  assert.match(cov, /scan scope UNKNOWN/);
  assert.match(cov, /Not a claim that nothing was excluded/);
  assert.ok(!/scope bounded/.test(cov), 'an unknown scope must not borrow the confident wording');
});

test('a payload with no scanScopes makes no claim at all', () => {
  const h = harness();
  h.render({ scanners: { secrets: { total: 1, ran: 1, skipped: 0, noscan: 0 } }, scannerFindings: { secrets: rows(1) } });
  const cov = h.el('sec-cov').innerHTML;
  assert.ok(!/scope bounded/.test(cov) && !/UNKNOWN/.test(cov), 'silence is correct when the server said nothing');
});

test('the gitleaks scope is not attached to tabs it does not bound', () => {
  const h = harness();
  h.render({ scanners: { secrets: { total: 0, ran: 1, skipped: 0, noscan: 0 }, maliciousPackages: { total: 0, ran: 1, skipped: 0, noscan: 0 } },
    scannerFindings: { secrets: [], maliciousPackages: [] }, scanScopes: { secrets: SCOPE } });
  assert.match(h.el('sec-cov').innerHTML, /scope bounded/);
  assert.ok(!/scope bounded/.test(h.el('mal-cov').innerHTML),
    'gitleaks.toml bounds the secret scan only — claiming it elsewhere would be a fabricated provenance');
});

test('every tab reads ITS OWN scanner scope — command-derived bounds and notes render', () => {
  const h = harness();
  h.render({
    scanners: { sastSemgrep: { total: 3, ran: 1, skipped: 0, noscan: 0 }, supplyChainHeuristic: { total: 1, ran: 1, skipped: 0, noscan: 0 } },
    scannerFindings: { sastSemgrep: [{ repo: 'r', rule: 'x', file: 'f.js', line: 1, sev: 'high', message: 'm' }], supplyChainHeuristic: [] },
    scanScopes: {
      sastSemgrep: { known: true, source: 'manifests/security-baseline.json',
        blocks: [{ description: 'paths excluded by --exclude in the sast command', paths: ['reference', 'reports'], targetRules: null }], notes: [] },
      supplyChainHeuristic: { known: true, source: 'manifests/security-baseline.json', blocks: [],
        notes: ['runs inside docker — on a box without docker the check is skipped, not scanned'] },
    },
  });
  const sg = h.el('sg-cov').innerHTML;
  assert.match(sg, /scope bounded/);
  assert.match(sg, /<b>2<\/b> path pattern\(s\) excluded from every rule/);
  assert.match(sg, /security-baseline\.json/, 'a command-derived bound names the manifest as its source');
  const gd = h.el('gd-cov').innerHTML;
  assert.match(gd, /scope bounded/);
  assert.match(gd, /runs inside docker/, 'a non-path bound (notes) must render in the same card');
  assert.ok(!/<details/.test(gd), 'no exclusion blocks — no empty details element');
});

test('scope text is escaped — the description and paths reach innerHTML', () => {
  const h = harness();
  h.render({ scanners: { secrets: { total: 0, ran: 1, skipped: 0, noscan: 0 } }, scannerFindings: { secrets: [] },
    scanScopes: { secrets: { known: true, source: 'x.toml', maxTargetMB: null,
      blocks: [{ description: '<script>bad()</script>', paths: ['<img src=x onerror=alert(1)>'], targetRules: null }] } } });
  const cov = h.el('sec-cov').innerHTML;
  assert.ok(!cov.includes('<script>bad') && !cov.includes('<img src=x'), `unescaped markup reached the card: ${cov}`);
  assert.ok(cov.includes('&lt;img'), 'the text should still be visible, escaped');
});

// ── rows < total is three different facts ────────────────────────────────────────────────────
// Every shortfall used to render as "truncated · the rollup caps detail per repo". Measured
// 2026-08-03 that was wrong for every case on disk — the cap is 2500 and nothing was near it. One
// area was carrying counts forward from a slice that had no rows; another's rollup predated the
// extractor and its batch artifacts had since been compacted away. A confidently wrong explanation
// sends a reader to raise a limit when what they need is a sweep, which is worse than no
// explanation at all. The rollup now declares which case it is; these pin that it is read, not
// guessed.

const S = (extra) => ({ scanners: { secrets: { total: 10, ran: 1, skipped: 0, noscan: 0, ...extra } }, scannerFindings: { secrets: rows(4) } });

test('a REAL cap says truncated, and says how many it dropped', () => {
  const h = harness();
  h.render(S({ detail: { rows: 4, truncated: 6, noDetail: [] } }));
  const cov = h.el('sec-cov').innerHTML;
  assert.match(cov, /truncated/);
  assert.match(cov, /the cap dropped 6 row\(s\)/);
});

test('a carried category says the COUNT came forward and the rows did not — not "truncated"', () => {
  const h = harness();
  h.render(S({ carried: true, carriedFrom: 'sweep-20260726201132', carriedAt: iso(9e7) }));
  const cov = h.el('sec-cov').innerHTML;
  assert.match(cov, /counts carried, detail not/);
  assert.match(cov, /sweep-20260726201132/);
  assert.ok(!/the cap dropped/.test(cov), 'a carried shortfall is not a cap and must not claim to be');
});

test('repos that reported counts but no rows are NAMED', () => {
  const h = harness();
  h.render(S({ detail: { rows: 4, truncated: 0, noDetail: ['clientDRemote', 'project-c'] } }));
  const cov = h.el('sec-cov').innerHTML;
  assert.match(cov, /partial detail · 2 repo\(s\)/);
  assert.match(cov, /clientDRemote, project-c/);
  assert.match(cov, /Re-roll their batch/);
});

test('a rollup too old to say why admits it, rather than borrowing the cap explanation', () => {
  const h = harness();
  h.render(S({}));                       // no `detail` block at all — pre-provenance rollup
  const cov = h.el('sec-cov').innerHTML;
  assert.match(cov, /detail unavailable/);
  assert.match(cov, /cannot say why/);
  assert.match(cov, /NOT a cap/);
  assert.ok(!/the cap dropped/.test(cov));
});

test('rows === total makes no shortfall claim of any kind', () => {
  const h = harness();
  h.render({ scanners: { secrets: { total: 4, ran: 1, skipped: 0, noscan: 0, detail: { rows: 4, truncated: 0, noDetail: [] } } }, scannerFindings: { secrets: rows(4) } });
  const cov = h.el('sec-cov').innerHTML;
  assert.ok(!/truncated|detail unavailable|partial detail|counts carried/.test(cov), `a complete list must say nothing: ${cov}`);
});

// ── THE POPULATION SPLIT ─────────────────────────────────────────────────────────────────────────
// A lane can set rows aside for two reasons that are not "clean": the row describes a test corpus
// (fixture-paths.mjs) or the advisory that matched could not reach the installed version
// (advisory-reach.mjs). Both counts lived only in the rollup JSON, so the malicious-packages table
// showed 0 with 24 fixture rows and 2 unreachable ones unmentioned underneath it. A zero with no
// denominator is the false clean this page exists to refuse.

test('rows set aside are stated beside the ones published, with the denominator', () => {
  const h = harness();
  h.render({
    scanners: { maliciousPackages: { total: 0, crit: 0, ran: 30, skipped: 0, noscan: 0,
      fixtures: { total: 24, crit: 24 }, undetermined: 2 } },
    scannerFindings: { maliciousPackages: [] },
  });
  const cov = h.el('mal-cov').innerHTML;
  assert.match(cov, /24 in test fixtures/);
  assert.match(cov, /2 undetermined/);
  assert.match(cov, /of 26 matched/, 'the denominator is published + fixture + undetermined');
});

test('an undetermined row is never described as safe', () => {
  const h = harness();
  h.render({
    scanners: { maliciousPackages: { total: 0, crit: 0, ran: 30, skipped: 0, noscan: 0, undetermined: 2 } },
    scannerFindings: { maliciousPackages: [] },
  });
  const cov = h.el('mal-cov').innerHTML;
  assert.match(cov, /neither a finding nor a pass/);
  assert.match(cov, /not a statement that the package is safe/);
  assert.ok(!/class="pill live"/.test(cov), 'set-aside rows must never render a clean pill');
});

test('a lane with nothing set aside gets no banner — an empty claim is not published', () => {
  const h = harness();
  h.render({
    scanners: { maliciousPackages: { total: 0, crit: 0, ran: 30, skipped: 0, noscan: 0 } },
    scannerFindings: { maliciousPackages: [] },
  });
  assert.ok(!/matched\./.test(h.el('mal-cov').innerHTML), 'no split, no line');
});

test('the split is generic — any lane that grows the fields gets it', () => {
  const h = harness();
  h.render({
    scanners: { secrets: { total: 3, ran: 10, skipped: 0, noscan: 0, fixtures: { total: 7 } } },
    scannerFindings: { secrets: rows(3) },
  });
  assert.match(h.el('sec-cov').innerHTML, /7 in test fixtures/);
  assert.match(h.el('sec-cov').innerHTML, /of 10 matched/);
});
