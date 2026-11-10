// Rule titles for the lanes that do not emit SARIF: each reads a rule-level field of its own tool,
// or the rule list the tool publishes (monitor/rule-titles.mjs), and returns one sorted
// {rule: title} map beside its rows, as _sarifDetail does. A per-hit message never becomes a title.
// Every artifact here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _banditCounts, _brakemanCounts, _shellcheckCounts, _cobolworkCounts } from '../extractors/sast-lint.mjs';
import { _cargoAuditCounts, _bundlerAuditCounts, _guarddogCounts } from '../extractors/supply-chain.mjs';
import { _gitleaksCounts } from '../extractors/secrets.mjs';
import { _hadolintCounts } from '../extractors/posture.mjs';
import { ruleTitleText } from '../sarif-read.mjs';
import { parseShellcheckSitemap, parseHadolintReadme, buildTable, serialise, publishedTitles, publishedTitle } from '../rule-titles.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function inDir(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-rule-titles-'));
  try {
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
    return fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// A synthetic table at CW_RULE_TITLES for the duration of fn; `null` points it at no file.
function withTable(titles, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-rule-table-'));
  const prev = process.env.CW_RULE_TITLES;
  try {
    const p = join(dir, 'rule-titles.json');
    if (titles !== null) writeFileSync(p, typeof titles === 'string' ? titles : JSON.stringify({ titles }));
    process.env.CW_RULE_TITLES = p;
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CW_RULE_TITLES; else process.env.CW_RULE_TITLES = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('ruleTitleText cleans to one line, caps, and refuses the id or a generic class', () => {
  assert.equal(ruleTitleText('  two\nlines\there ', 'X1'), 'two lines here');
  assert.equal(ruleTitleText('X1', 'X1'), null);
  assert.equal(ruleTitleText('About X1 again', 'X1'), null);
  assert.equal(ruleTitleText('Warning', 'X1'), null);
  assert.equal(ruleTitleText('', 'X1'), null);
  const long = ruleTitleText('w '.repeat(200), 'X1');
  assert.ok(long.length <= 100 && long.endsWith('…'));
});

test('the ShellCheck sitemap parser decodes entities and drops markup', () => {
  const html = "<ul>\n<li><a href='SC1000'>SC1000</a> &ndash; `$` is not used specially.</li>\n"
    + "<li><a href='SC2002'>SC2002</a> &ndash; Useless cat. Use <code>cmd &lt; file &#124; ..</code>\n instead.</li>\n"
    + "<li><a href='SC9999'>SC9999</a> &ndash; </li></ul>";
  assert.deepEqual(parseShellcheckSitemap(html), {
    SC1000: '`$` is not used specially.',
    SC2002: 'Useless cat. Use cmd < file | .. instead.',
  });
});

test("the hadolint README parser reads DL and SC rows, keeps `<package>` as text and decodes an escaped pipe", () => {
  const md = [
    '| Rule | Default Severity | Description |',
    '|:--|:--|:--|',
    '| [DL3008](https://example.invalid/DL3008) | Warning | Pin versions in `apt-get install`. |',
    '| [DL3018](https://example.invalid/DL3018) | Warning | Use `apk add <package>=<version>`. |',
    '| [SC2164](https://example.invalid/SC2164) |         | Use <code>cd ... &#124;&#124; exit</code> in case `cd` fails. |',
    '| not a rule row | x | y |',
  ].join('\n');
  assert.deepEqual(parseHadolintReadme(md), {
    DL3008: 'Pin versions in `apt-get install`.',
    DL3018: 'Use `apk add <package>=<version>`.',
    SC2164: 'Use `cd ... || exit` in case `cd` fails.',
  });
});

test('buildTable refuses an empty list or an undated build, and serialises byte-identically', () => {
  const html = "<li><a href='SC1000'>SC1000</a> &ndash; One.</li>";
  const md = '| [DL3000](u) | Error | Use absolute WORKDIR. |';
  assert.throws(() => buildTable({ shellcheckHtml: '', hadolintMd: md, retrieved: '2026-01-01' }), /ShellCheck/);
  assert.throws(() => buildTable({ shellcheckHtml: html, hadolintMd: '', retrieved: '2026-01-01' }), /hadolint/);
  assert.throws(() => buildTable({ shellcheckHtml: html, hadolintMd: md, retrieved: 'today' }), /retrieved/);
  const a = serialise(buildTable({ shellcheckHtml: html, hadolintMd: md, retrieved: '2026-01-01' }));
  const b = serialise(buildTable({ shellcheckHtml: html, hadolintMd: md, retrieved: '2026-01-01' }));
  assert.equal(a, b);
  assert.deepEqual(JSON.parse(a).titles, { hadolint: { DL3000: 'Use absolute WORKDIR.' }, shellcheck: { SC1000: 'One.' } });
});

test('a published map answers own keys only, and an absent or unreadable table titles nothing', () => {
  assert.equal(publishedTitle({ SC1000: 'One.' }, 'constructor'), null);
  assert.equal(publishedTitle({ SC1000: 'One.' }, 'SC1000'), 'One.');
  withTable(null, () => assert.equal(publishedTitles('shellcheck'), null));
  withTable('{ torn', () => assert.equal(publishedTitles('shellcheck'), null));
  withTable({ shellcheck: ['not', 'a', 'map'] }, () => assert.equal(publishedTitles('shellcheck'), null));
});

test('the shipped table is readable and holds both published lists', () => {
  const p = join(CW, 'monitor', 'data', 'rule-titles.json');
  const j = JSON.parse(readFileSync(p, 'utf8'));
  for (const tool of ['shellcheck', 'hadolint']) {
    const m = publishedTitles(tool, p);
    assert.ok(m && Object.keys(m).length >= 100, `${tool}: the shipped table must load, or every title silently disappears`);
    assert.equal(j.sources[tool].codes, Object.keys(m).length);
    assert.match(j.sources[tool].url, /^https:\/\//);
    for (const [k, v] of Object.entries(m)) {
      assert.ok(/^(SC|DL)\d{4}$/.test(k) && typeof v === 'string' && v, `${tool} ${k}`);
      assert.doesNotMatch(v, /\n|<\/?code>|&#?\w+;/, `${tool} ${k}: one line, markup and entities decoded`);
    }
  }
});

test('shellcheck: titles come from the published list, never from the per-hit message', () => {
  const art = { comments: [
    { file: 'a.sh', line: 1, level: 'warning', code: 2034, message: 'alpha appears unused. Verify use.' },
    { file: 'b.sh', line: 2, level: 'warning', code: 2034, message: 'beta appears unused. Verify use.' },
    { file: 'c.sh', line: 3, level: 'error', code: 1017, message: 'Literal carriage return.' },
  ] };
  inDir({ 'shellcheck.json': art }, (dir) => {
    withTable({ shellcheck: { SC2034: 'foo appears unused. Verify it or export it.', SC2086: 'Double quote.' } }, () => {
      assert.deepEqual(_shellcheckCounts(dir, 'shellcheck.json').ruleTitles, { SC2034: 'foo appears unused. Verify it or export it.' },
        'a code the list does not carry stays untitled; a code with no row is not listed');
    });
    withTable(null, () => assert.equal(_shellcheckCounts(dir, 'shellcheck.json').ruleTitles, undefined, 'no table, no titles — the message is never the fallback'));
  });
  inDir({ 'shellcheck.json': '{ torn' }, (dir) => withTable({ shellcheck: { SC1017: 'x' } }, () => {
    const c = _shellcheckCounts(dir, 'shellcheck.json');
    assert.equal(c.unparseable, true);
    assert.equal(c.ruleTitles, undefined);
  }));
});

test('hadolint: its own table first, then ShellCheck for an SC code it leaves out', () => {
  const art = [
    { code: 'DL3008', level: 'warning', file: 'Dockerfile', line: 3, message: 'Pin versions in apt get install. Instead of …' },
    { code: 'SC2016', level: 'info', file: 'Dockerfile', line: 4, message: 'Expressions do not expand in single quotes: $X' },
    { code: 'SC2086', level: 'info', file: 'Dockerfile', line: 5, message: 'Double quote to prevent globbing.' },
    { code: 'DL1000', level: 'error', file: 'Dockerfile', line: 1, message: 'unexpected token' },
  ];
  inDir({ 'hadolint.json': art }, (dir) => withTable({
    hadolint: { DL3008: 'Pin versions in `apt-get install`.', SC2086: 'Double quote to prevent globbing and word splitting.' },
    shellcheck: { SC2016: "Expressions don't expand in single quotes, use double quotes for that.", SC2086: 'ShellCheck wording.', DL1000: 'never read' },
  }, () => {
    assert.deepEqual(_hadolintCounts(dir, 'hadolint.json').ruleTitles, {
      DL3008: 'Pin versions in `apt-get install`.',
      SC2016: "Expressions don't expand in single quotes, use double quotes for that.",
      SC2086: 'Double quote to prevent globbing and word splitting.',
    });
  }));
});

test('bandit: test_name with spaces; the shared `blacklist` name and issue_text are never titles', () => {
  const r = (test_id, test_name, issue_text, issue_severity = 'LOW') => ({ filename: 'a.py', line_number: 1, test_id, test_name, issue_text, issue_severity, issue_confidence: 'HIGH' });
  const art = { results: [
    r('B603', 'subprocess_without_shell_equals_true', 'subprocess call - check for execution of untrusted input.'),
    r('B404', 'blacklist', 'Consider possible security implications associated with the subprocess module.'),
    r('B101', 'assert_used', 'Use of assert detected.'),
    r('B999', 'odd_one', 'not counted', 'UNDEFINED'),
  ], errors: [] };
  inDir({ 'bandit.json': art }, (dir) => {
    const c = _banditCounts(dir, 'bandit.json');
    assert.deepEqual(c.ruleTitles, { B101: 'assert used', B603: 'subprocess without shell equals true' });
    assert.deepEqual(Object.keys(c.ruleTitles), Object.keys(c.ruleTitles).sort(), 'keys sorted');
    assert.ok(c.findings.every((f) => !('title' in f)), 'titles ride beside the rows, never in them');
  });
});

test('brakeman: warning_type titles a check; a check with two types in one report gets none', () => {
  const w = (check_name, warning_type) => ({ check_name, warning_type, message: `matched ${check_name}`, file: 'app/x.rb', line: 1, confidence: 'High' });
  const art = { warnings: [w('Evaluation', 'Dangerous Eval'), w('Evaluation', 'Dangerous Eval'), w('Render', 'Dynamic Render Path'),
    w('Render', 'Remote Code Execution'), w('SQL', 'SQL Injection')] };
  // SQL: a title that contains the id is refused, the rule ruleTitle applies to every lane
  inDir({ 'brakeman.json': art }, (dir) => assert.deepEqual(_brakemanCounts(dir, 'brakeman.json').ruleTitles, { Evaluation: 'Dangerous Eval' }));
});

test("cobolwork: ruleText is the title; a report without it gives none, and detail never does", () => {
  const report = (extra) => ({ tool: 'cobolwork', schemaVersion: 3, summary: { findings: 2, filesScanned: 2 }, ...extra, findings: [
    { rule: 'argv-to-os-command', path: 'src/A.cbl', line: 10, sev: 'high', evidence: 'path', detail: 'WS-CMD reaches CALL SYSTEM' },
    { rule: 'unlisted-rule', path: 'src/B.cbl', line: 20, sev: 'med', evidence: 'construct', detail: 'something specific' },
  ] });
  inDir({ 'cobolwork.json': report({ ruleText: { 'argv-to-os-command': 'Command-line input reaches an operating-system command routine', 'unused-rule': 'No row names this rule' } }) }, (dir) => {
    assert.deepEqual(_cobolworkCounts(dir, 'cobolwork.json').ruleTitles, { 'argv-to-os-command': 'Command-line input reaches an operating-system command routine' });
  });
  inDir({ 'cobolwork.json': report({}) }, (dir) => assert.equal(_cobolworkCounts(dir, 'cobolwork.json').ruleTitles, undefined));
});

test('cargo-audit and bundler-audit: the advisory title, only where the advisory has an id', () => {
  const cargo = { vulnerabilities: { found: true, count: 2, list: [
    { advisory: { id: 'RUSTSEC-0000-0001', package: 'demo', title: 'Unchecked length in demo' }, package: { name: 'demo', version: '1.0.0' } },
    { advisory: { package: 'nameless', title: 'Advisory with no id' }, package: { name: 'nameless', version: '0.1.0' } },
  ] }, warnings: {} };
  inDir({ 'cargo-audit.json': cargo }, (dir) => assert.deepEqual(_cargoAuditCounts(dir, 'cargo-audit.json').ruleTitles, { 'RUSTSEC-0000-0001': 'Unchecked length in demo' }));
  const bundler = { results: [
    { type: 'unpatched_gem', gem: { name: 'demo', version: '1.0' }, advisory: { id: 'CVE-0000-0002', criticality: 'high', title: 'Possible XSS in demo' } },
    { type: 'unpatched_gem', gem: { name: 'demo', version: '1.0' }, advisory: { id: 'CVE-0000-0003', criticality: 'low', title: 'CVE-0000-0003' } },
  ] };
  inDir({ 'bundler-audit.json': bundler }, (dir) => assert.deepEqual(_bundlerAuditCounts(dir, 'bundler-audit.json').ruleTitles, { 'CVE-0000-0002': 'Possible XSS in demo' },
    'a title that restates the id is not a title'));
});

test("guarddog: the rule's full description titles it; the per-package message never does", () => {
  const sarif = { runs: [{
    tool: { driver: { name: 'guarddog', rules: [
      { id: 'threat-demo', shortDescription: { text: 'GuardDog rule: threat-demo' }, fullDescription: { text: 'Detects a demo pattern. More detail follows.' } },
      { id: 'bare-rule' },
    ] } },
    invocations: [{ executionSuccessful: true }],
    results: [
      { ruleId: 'threat-demo', message: { text: 'On package: demo version: 1.0.0\nDetects a demo pattern in demo/index.js' } },
      { ruleId: 'bare-rule', message: { text: 'On package: other version: 2.0.0\nsomething' } },
    ],
  }] };
  inDir({ 'guarddog.sarif': sarif }, (dir) => assert.deepEqual(_guarddogCounts(dir, 'guarddog.sarif').ruleTitles, { 'threat-demo': 'Detects a demo pattern.' }));
});

// The secret lanes: a gitleaks record carries the matched text in Match, Secret and Line, and a
// commit message in Message. None of them may reach a title; only the rule's Description may.
test('secret lanes: no title is ever derived from matched text or a message', () => {
  const MATCHED = 'matched-text-sentinel-7f3a';
  const rec = (RuleID, extra) => ({ RuleID, File: 'conf/app.env', StartLine: 3, Match: `KEY=${MATCHED}`, Secret: MATCHED, Line: `KEY=${MATCHED}`, Message: `commit ${MATCHED}`, Tags: [MATCHED], Fingerprint: `conf/app.env:${RuleID}:3`, ...extra });
  for (const [category, file, verdict] of [['secrets', 'gitleaks.json', 'gitleaks-verify.json'], ['mainframeSecrets', 'gitleaks-mainframe.json', 'gitleaks-mainframe-verify.json']]) {
    inDir({ [file]: [rec('demo-token'), rec('other-token', { Description: '' })] }, (dir) => {
      const c = _gitleaksCounts(dir, file, verdict, category);
      assert.equal(c.total, 2);
      assert.equal(c.ruleTitles, undefined, `${category}: with no Description there is no title, whatever else the record carries`);
      assert.doesNotMatch(JSON.stringify(c), new RegExp(MATCHED));
    });
    inDir({ [file]: [rec('demo-token', { Description: 'Identified a demo token, which may grant access.' })] }, (dir) => {
      const c = _gitleaksCounts(dir, file, verdict, category);
      assert.deepEqual(c.ruleTitles, { 'demo-token': 'Identified a demo token, which may grant access.' });
      assert.doesNotMatch(JSON.stringify(c), new RegExp(MATCHED));
    });
  }
});

test('same artifact, same map, byte for byte', () => {
  const art = { results: [
    { filename: 'b.py', line_number: 2, test_id: 'B110', test_name: 'try_except_pass', issue_text: 'x', issue_severity: 'LOW' },
    { filename: 'a.py', line_number: 1, test_id: 'B105', test_name: 'hardcoded_password_string', issue_text: 'y', issue_severity: 'LOW' },
  ] };
  inDir({ 'bandit.json': art }, (dir) => {
    const a = JSON.stringify(_banditCounts(dir, 'bandit.json').ruleTitles);
    const b = JSON.stringify(_banditCounts(dir, 'bandit.json').ruleTitles);
    assert.equal(a, b);
    assert.equal(a, '{"B105":"hardcoded password string","B110":"try except pass"}');
  });
});
