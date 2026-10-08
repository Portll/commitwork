// The remediation brief (bin/lib/brief.mjs), whole-machine discovery (bin/lib/scan-target.mjs) and
// `commitwork brief`, over fixture scan runs: nothing here runs a scanner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBrief, renderBriefText, renderBriefMarkdown, renderBriefHtml } from '../lib/brief.mjs';
import { discoverPcRepos } from '../lib/scan-target.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(join(CW, 'manifests', 'security-baseline.json'), 'utf8'));
const write = (p, body) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body)); };

const helpFor = (rows) => `### Fixed Versions\n\n| Vulnerability ID | Package Name | Fixed Version |\n| --- | --- | --- |\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n\nend\n`;
const osvSarif = (advs) => ({ version: '2.1.0', runs: [{
  tool: { driver: { name: 'osv-scanner', rules: advs.map((a) => ({ id: a.id, shortDescription: { text: `${a.id}: a flaw in ${a.pkg}` },
    properties: { 'security-severity': String(a.cvss) }, help: { text: helpFor([[a.id, a.pkg, a.fixed]]) } })) } },
  invocations: [{ executionSuccessful: true }],
  results: advs.map((a) => ({ ruleId: a.id, message: { text: `Package '${a.pkg}@${a.version}' is vulnerable to '${a.id}'.` },
    locations: [{ physicalLocation: { artifactLocation: { uri: a.uri || 'package-lock.json' } } }] })),
}] });
const semgrepSarif = (results) => ({ version: '2.1.0', runs: [{
  tool: { driver: { name: 'semgrep', rules: [...new Set(results.map((r) => r.rule))].map((id) => ({ id })) } },
  invocations: [{ executionSuccessful: true }],
  results: results.map((r) => ({ ruleId: r.rule, level: r.level, message: { text: r.message },
    locations: [{ physicalLocation: { artifactLocation: { uri: r.file }, region: { startLine: r.line } } }],
    ...(r.suppressed ? { suppressions: [{ kind: 'inSource' }] } : {}) })),
}] });

function fixtureRun() {
  const run = mkdtempSync(join(tmpdir(), 'cw-brief-run-'));
  const dir = join(run, 'app');
  write(join(dir, 'summary.md'), '# Security report — app\n\nRepo: `/src/app`\n');
  write(join(dir, 'osv.sarif'), osvSarif([
    { id: 'CVE-2020-0001', pkg: 'big', version: '1.0.0', cvss: 9.8, fixed: '1.0.1' },
    { id: 'CVE-2020-0002', pkg: 'small', version: '2.0.0', cvss: 5.0, fixed: '2.0.5' },
    { id: 'CVE-2020-0003', pkg: 'small', version: '2.0.0', cvss: 7.5, fixed: '2.1.0' },
    { id: 'CVE-2020-0004', pkg: 'loose', version: '0.1.0', cvss: 9.1, fixed: '0.2.0', uri: 'requirements.txt' },
  ]));
  write(join(dir, 'osv-declared.json'), { ran: true, manifests: { 'requirements.txt': { resolved: ['loose@0.1.0'] } } });
  // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
  write(join(dir, 'semgrep.sarif'), semgrepSarif([
    { rule: 'r.open', level: 'error', file: 'src/a.js', line: 3, message: 'tainted <script>alert(1)</script> reaches eval' },
    { rule: 'r.hidden', level: 'error', file: 'src/b.js', line: 9, message: 'reviewed', suppressed: true },
  ]));
  const rows = [{ repo: '/src/app', slug: 'app', commit: 'abc123', cells: {
    'deps-osv': { sev: 'high', summary: '4 advisories' },
    sast: { sev: 'high', summary: '2 (2e/0w)' },
    'dast-nuclei': { sev: 'noscan', summary: 'runtime scanner did not run — no live URL' },
    'sast-opengrep': { sev: 'med', summary: '2', coverage: 'reduced', coverageReason: 'the tool exited 2' },
    'shell-lint': { sev: 'skip', summary: 'no .sh sources' },
  } }];
  return { run, rows };
}
const KEV = { set: new Set(['CVE-2020-0002']), usable: true, freshness: { catalogVersion: '2026.10.01', state: 'fresh', ageDays: 3 } };
const EPSS = { 'CVE-2020-0001': 0.5, 'CVE-2020-0002': 0.1 };
const brief = (over = {}) => { const { run, rows } = fixtureRun(); return buildBrief({ runDir: run, rows, manifest, kev: KEV, epss: EPSS, generatedAt: '2026-10-04T00:00:00.000Z', ...over }); };

test('a KEV advisory ranks first even below a critical, and one upgrade carries every advisory on that package', () => {
  const b = brief();
  assert.deepEqual(b.actions.map((a) => a.package), ['small', 'big']);
  assert.equal(b.actions[0].kev, 1);
  assert.equal(b.actions[0].worst, 'high');
  assert.equal(b.actions[0].fix, '2.0.5 or 2.1.0');
  assert.deepEqual(b.actions[0].findings.map((f) => f.id), ['CVE-2020-0002', 'CVE-2020-0003']);
  assert.equal(b.actions[1].worst, 'crit');
  assert.equal(b.counts.kev, 1);
});

test('an advisory on a version the manifest never declared is undetermined, not an action', () => {
  const b = brief();
  assert.ok(!b.actions.some((a) => a.package === 'loose'));
  assert.deepEqual(b.undetermined.map((u) => [u.id, u.claimed]), [['CVE-2020-0004', 'crit']]);
});

test('a finding suppressed in source is counted apart, and the open one is listed', () => {
  const sast = brief().issues.find((i) => i.category === 'sastSemgrep');
  assert.equal(sast.open, 1);
  assert.equal(sast.suppressed, 1);
  assert.deepEqual(sast.top.map((t) => t.rule), ['r.open']);
});

test('a void and a degraded lane are not measured, and a lane that does not apply is not listed', () => {
  const nm = brief().notMeasured.map((n) => `${n.check}:${n.kind}`);
  assert.deepEqual(nm, ['dast-nuclei:void', 'sast-opengrep:degraded']);
});

test('an unread KEV catalogue leaves kev null, and the brief says it was not consulted', () => {
  const b = brief({ kev: { set: new Set(), usable: false, freshness: { catalogVersion: null, state: 'unknown' } } });
  assert.ok(b.actions.every((a) => a.findings.every((f) => f.kev === null)));
  assert.equal(b.enrichment.kev.consulted, false);
  assert.match(renderBriefText(b), /KEV not consulted/);
});

test('the same run gives the same brief, and the HTML escapes what a scanner reported', () => {
  const a = brief();
  const b = brief();
  assert.deepEqual(a, b);
  assert.equal(renderBriefMarkdown(a), renderBriefMarkdown(b));
  const html = renderBriefHtml(a);
  assert.equal(html, renderBriefHtml(b));
  // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
  assert.ok(!html.includes('<script>alert(1)'), 'a message cannot write markup');
  assert.match(html, /&lt;script&gt;alert\(1\)/);
});

test('a whole-machine walk sets collections aside and excludes stores, the checkout and the output', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'cw-brief-home-')));
  for (const r of ['proj/a', 'proj/b', 'coll/r1', 'coll/r2', 'coll/r3', '.ssh/keys', 'cw', 'out/x']) mkdirSync(join(home, r, '.git'), { recursive: true });
  const prev = process.env.CW_PC_COLLECTION_MIN;
  process.env.CW_PC_COLLECTION_MIN = '3';
  try {
    const d = discoverPcRepos({ home, checkout: join(home, 'cw'), outBase: join(home, 'out') });
    assert.deepEqual(d.repos, [join(home, 'proj/a'), join(home, 'proj/b')]);
    assert.deepEqual(d.collections, [{ dir: join(home, 'coll'), count: 3 }]);
    assert.deepEqual(d.excluded.map((e) => e.path).sort(), [join(home, 'cw'), join(home, 'out/x')]);
    assert.ok(!d.repos.concat(d.excluded.map((e) => e.path)).some((p) => p.includes('/.ssh/')), 'a credential store is never walked');
    assert.equal(discoverPcRepos({ home, checkout: join(home, 'cw'), outBase: join(home, 'out'), includeCollections: true }).repos.length, 5);
  } finally {
    if (prev === undefined) delete process.env.CW_PC_COLLECTION_MIN; else process.env.CW_PC_COLLECTION_MIN = prev;
  }
});

const cli = (args, env = {}) => spawnSync(process.execPath, [join(CW, 'bin', 'commitwork.mjs'), ...args],
  { encoding: 'utf8', env: { ...process.env, CW_SKIP_SETUP: '1', CW_SELF_SWEEP: '0', ...env }, timeout: 60_000 });

test('brief --dry-run lists the repositories under a directory', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cw-brief-dir-')));
  for (const r of ['one', 'nest/two']) mkdirSync(join(root, r, '.git'), { recursive: true });
  const out = realpathSync(mkdtempSync(join(tmpdir(), 'cw-brief-out-')));
  const r = cli(['brief', root, '--dry-run'], { CW_SCAN_PATH_OUT: out });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n').filter((l) => l.startsWith('/')), [join(root, 'nest/two'), join(root, 'one')]);
});

test('brief --dry-run refuses a directory holding the checkout', (t) => {
  const parent = dirname(realpathSync(CW));
  const home = realpathSync(homedir());
  // A parent that also holds HOME overlaps ~/.ssh, and that refusal fires first: a clone in ~, or a
  // candidate whose scratch HOME sits beside the checkout. The checkout refusal cannot be isolated.
  if (home === parent || home.startsWith(`${parent}${sep}`)) {
    t.skip(`the checkout's parent ${parent} also holds HOME, so the checkout refusal was NOT verified here`);
    return;
  }
  const out = realpathSync(mkdtempSync(join(tmpdir(), 'cw-brief-out-')));
  const refused = cli(['brief', parent, '--dry-run'], { CW_SCAN_PATH_OUT: out });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /contains the commitwork checkout[\s\S]*commitwork brief --pc/);
});

test('brief --from rebuilds a finished run from its scan.json and writes the three forms', () => {
  const { run, rows } = fixtureRun();
  write(join(run, 'scan.json'), { version: 1, baseline: manifest.repo, repos: rows.map(({ repo, slug, cells }) => ({ repo, slug, cells })) });
  const kev = join(run, 'kev.json');
  write(kev, { catalogVersion: '2026.10.01', dateReleased: '2026-10-01T00:00:00Z', vulnerabilities: [{ cveID: 'CVE-2020-0002' }] });
  const r = cli(['brief', '--from', run], { CW_KEV_PATH: kev, CW_EPSS_PATH: join(run, 'none.json'), CW_NOW: '2026-10-04T00:00:00Z' });
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['brief.json', 'brief.md', 'brief.html']) assert.ok(existsSync(join(run, f)), f);
  const b = JSON.parse(readFileSync(join(run, 'brief.json'), 'utf8'));
  assert.equal(b.actions[0].package, 'small');
  assert.equal(b.enrichment.kev.catalogVersion, '2026.10.01');
  assert.match(r.stdout, /1\) app: small@2\.0\.0 → 2\.0\.5 or 2\.1\.0 {2}\[KEV ×1 · high/);
});

test('the walk takes several output roots, so an --out elsewhere does not unguard the sidecar', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'cw-brief-home2-')));
  for (const r of ['proj/a', 'sidecar', 'elsewhere/out']) mkdirSync(join(home, r, '.git'), { recursive: true });
  const d = discoverPcRepos({ home, checkout: join(home, 'cw'), outBase: [join(home, 'sidecar'), join(home, 'elsewhere')] });
  assert.deepEqual(d.repos, [join(home, 'proj/a')]);
  assert.deepEqual(d.excluded.map((e) => e.reason).sort(), [`overlaps ${join(home, 'elsewhere')}, where scan output goes`, `overlaps ${join(home, 'sidecar')}, where scan output goes`]);
  const r = cli(['brief', '--pc', '--dry-run', '--out', join(home, 'elsewhere', 'out', 'run')], { HOME: home, CW_SCAN_PATH_OUT: '', CW_SIDECAR: join(home, 'sidecar') });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.split('\n').filter((l) => l.startsWith('/')), [join(home, 'proj/a')], 'the panel passes --out, and the sidecar or the --out tree was scanned');
  assert.match(r.stdout, new RegExp(`excluded ${join(home, 'sidecar')}: overlaps ${join(home, 'sidecar')}, where scan output goes`));
  assert.match(r.stdout, new RegExp(`excluded ${join(home, 'elsewhere', 'out')}: overlaps ${join(home, 'elsewhere', 'out', 'run')}, where scan output goes`));
});

test('an advisory link is drawn only for http(s); anything else is the id as text', () => {
  const b = brief();
  b.actions[0].findings[0].advisory = 'javascript:alert(1)';
  b.actions[1].findings[0].advisory = 'https://osv.dev/vulnerability/CVE-2020-0001';
  const html = renderBriefHtml(b);
  assert.ok(!html.includes('href="javascript:'), 'a javascript: URL became a link');
  assert.match(html, /<a href="https:\/\/osv\.dev\/vulnerability\/CVE-2020-0001">/);
});

test('brief --from reads a sweep batch: no summary.md, the repo and its scanned commit from the batch manifest', () => {
  const { run } = fixtureRun();
  rmSync(join(run, 'app', 'summary.md'));
  write(join(run, 'batch-manifest.json'), { anchors: { app: { path: '/src/app', sha: 'feedface' } } });
  const r = cli(['brief', '--from', run], { CW_KEV_PATH: join(run, 'none.json'), CW_EPSS_PATH: join(run, 'none.json'), CW_NOW: '2026-10-04T00:00:00Z' });
  assert.equal(r.status, 0, r.stderr);
  const b = JSON.parse(readFileSync(join(run, 'brief.json'), 'utf8'));
  assert.deepEqual(b.repos.map((x) => [x.name, x.path, x.commit]), [['app', '/src/app', 'feedface']], 'the scanned commit, never the tree as it is now');
  assert.ok(b.issues.length > 0);
});

test('brief --from refuses a directory holding no repository reports, rather than writing an empty brief', () => {
  const empty = mkdtempSync(join(tmpdir(), 'cw-brief-empty-'));
  mkdirSync(join(empty, 'not-a-repo'));
  const r = cli(['brief', '--from', empty]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /holds no repository's reports: .* unknown, not empty/);
  assert.ok(!existsSync(join(empty, 'brief.json')), 'an empty brief reads as a clean one');
});

// docs/THEME.md §3.4: the page follows the panel's theme, so its severity ramp is the house tokens
// and the exploited band is --sev. Fixed light values here were a second palette that held on dark.
test('the HTML takes its severity and exploited colours from the house tokens, with no literal of its own', async () => {
  const { houseCss } = await import('../../lib/house-css.mjs');
  const html = renderBriefHtml(brief());
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const own = style.replace(houseCss({ fonts: 'inline', weights: { sans: [400, 600], mono: [400] } }), '');
  assert.notEqual(own, style, 'the page no longer inlines the house sheet it is measured against');
  assert.doesNotMatch(own, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'a literal colour in the page rules');
  for (const s of ['crit', 'high', 'med', 'low']) assert.match(own, new RegExp(`\\.s-${s}\\{color:var\\(--${s}\\)\\}`), s);
  assert.match(own, /tr\.kev td\{background:color-mix\(in srgb,var\(--sev\) \d+%,transparent\)\}/);
});

test('a backslash before a pipe in scanned text stays inside its Markdown cell', () => {
  const b = brief();
  b.repos[0].name = 'repo\\|injected';
  const row = renderBriefMarkdown(b).split('\n').find((l) => l.includes('injected'));
  const delimiters = row.match(/(?<!\\)(?:\\\\)*\|/g).length;
  assert.equal(delimiters, 4, `the row split into extra cells: ${row}`);
});
