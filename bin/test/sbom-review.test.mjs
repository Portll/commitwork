// node --test bin/test/sbom-review.test.mjs — the SBOM review over a synthetic three-repo group.
//
// The load-bearing assertions are the refusals: a repo whose vulnerabilities were not looked up is
// never reported clean, a repo with no SBOM is never zero components, and a JSR package is never
// matched against an npm advisory of the same name.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFixture, FIXED_NOW } from './fixtures/sbom-review/build.mjs';
import { main, classifyLicence, scopeOf, kindOf, identityFlags, workflowRefs, inventoryOf, providerOf, ecosystemOf, identityOf, indexOsv, reviewRepo, severityBucket } from '../sbom-review.mjs';

let tmp; let fx; let review; let code;
const run = async (out, extra = []) => main(['--group', 'sample', '--reports', fx.reports, '--out', out, ...fx.repos.flatMap((r) => ['--repo', r]), ...extra]);

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'sbom-review-test-'));
  fx = buildFixture(tmp);
  process.env.CW_NOW = FIXED_NOW;
  process.env.DENO_DIR = join(tmp, 'no-deno-cache');
  delete process.env.CW_SBOM_REVIEW_REPORTS;
  code = await run(join(tmp, 'out'));
  review = JSON.parse(readFileSync(join(tmp, 'out', 'sbom-review.json'), 'utf8'));
});
after(() => { rmSync(tmp, { recursive: true, force: true }); delete process.env.CW_NOW; delete process.env.DENO_DIR; });

const repo = (name) => review.repos.find((r) => r.name === name);
const findings = (name) => review.findings.filter((f) => f.repo === name);

test('licence expressions: OR takes the permissive choice, AND the strict one, empty is unknown', () => {
  assert.equal(classifyLicence('MIT'), 'permissive');
  assert.equal(classifyLicence('(MPL-2.0 OR Apache-2.0)'), 'permissive');
  assert.equal(classifyLicence('MIT AND GPL-3.0-only'), 'strong-copyleft');
  assert.equal(classifyLicence('LGPL-2.1-or-later'), 'weak-copyleft');
  assert.equal(classifyLicence('SEE LICENSE IN LICENSE.md'), 'review');
  assert.equal(classifyLicence(''), 'unknown');
});

test('scope: an ignored binary is local-only, a node_modules workflow is installed, a tracked workflow is ci', () => {
  assert.equal(scopeOf('.tools/x.exe', kindOf('.tools/x.exe', 'go-module-binary-cataloger'), 'ignored'), 'local-only');
  assert.equal(scopeOf('node_modules/a/.github/workflows/ci.yml', 'workflow', 'ignored'), 'installed');
  assert.equal(scopeOf('.github/workflows/ci.yml', 'workflow', 'tracked'), 'ci');
  assert.equal(scopeOf('package-lock.json', 'manifest', 'tracked'), 'product');
  assert.equal(scopeOf('bin/tool', 'binary', 'tracked'), 'binary');
  assert.equal(scopeOf('gone.lock', 'manifest', 'missing'), 'unknown');
  assert.equal(scopeOf('', 'unlocated', 'unknown'), 'unknown');
});

test('identity flags: Go pseudo-versions, tag-pinned actions only in ci scope', () => {
  const go = { purl: 'pkg:golang/x@v0.0.0-20220314234659-1baeb1ce4c0b', version: 'v0.0.0-20220314234659-1baeb1ce4c0b' };
  assert.deepEqual(identityFlags(go, 'product'), ['pseudo-version']);
  assert.deepEqual(identityFlags({ purl: 'pkg:golang/t@v0.23.1-0.20260429145742-d2acd3c49e58', version: 'v0.23.1-0.20260429145742-d2acd3c49e58' }, 'product'), ['pseudo-version']);
  const tag = { purl: 'pkg:github/actions/checkout@v4', version: 'v4' };
  assert.deepEqual(identityFlags(tag, 'ci'), ['mutable-action-ref']);
  assert.deepEqual(identityFlags(tag, 'installed'), []);
  assert.deepEqual(identityFlags({ purl: 'pkg:github/a/b@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a', version: '1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a' }, 'ci'), []);
});

test('action pinning is read from the workflow line, not the version syft reports from its comment', () => {
  const refs = workflowRefs('steps:\n  - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0\n  - uses: "a/b@v1"\n');
  assert.deepEqual(identityFlags({ name: 'actions/checkout', purl: 'pkg:github/actions/checkout@v4.4.0', version: 'v4.4.0' }, 'ci', refs), []);
  assert.deepEqual(identityFlags({ name: 'a/b', purl: 'pkg:github/a/b@v1', version: 'v1' }, 'ci', refs), ['mutable-action-ref']);
  assert.deepEqual(identityFlags({ name: 'c/d', purl: 'pkg:github/c/d@v1', version: 'v1' }, 'ci', null), ['unverified-action-ref']);
});

test('fixture: the SHA-pinned action is not a finding, the tag-pinned one is', () => {
  assert.ok(!findings('billing-api').some((f) => /pinned by tag/.test(f.title)));
  const sf = findings('storefront').find((f) => /pinned by tag/.test(f.title));
  assert.match(sf.detail, /^actions\/checkout@v4\./);
});

test('a registry is matched on its whole host: a lookalike host is a URL import, not that registry', () => {
  const at = (url) => ({ name: 'x', version: '1.0.0', purl: `pkg:npm/x@1.0.0?repository_url=${encodeURIComponent(url)}` });
  assert.equal(ecosystemOf(at('https://jsr.io')), 'JSR');
  assert.equal(ecosystemOf(at('https://jsr.io/@std/assert')), 'JSR');
  assert.equal(ecosystemOf(at('https://jsr.io.example.com')), 'URL');
  assert.equal(ecosystemOf(at('https://esm.sh.example.com/x@1.0.0')), 'URL');
  assert.equal(ecosystemOf(at('https://registry.npmjs.org.example.com')), 'URL');
  assert.equal(ecosystemOf(at('https://registry.npmjs.org/')), 'npm');
});

test('a JSR package written as an npm purl is JSR, and never matched to an npm advisory', () => {
  const c = { name: '@std/assert', version: '1.0.19', purl: 'pkg:npm/%40std/assert@1.0.19?repository_url=https%3A%2F%2Fjsr.io',
    properties: [{ name: 'syft:location:0:path', value: '/deno.lock' }] };
  assert.equal(ecosystemOf(c), 'JSR');
  assert.notEqual(identityOf(c), identityOf({ ...c, purl: 'pkg:npm/%40std/assert@1.0.19' }));
  const osv = indexOsv({ results: [{ packages: [{ package: { ecosystem: 'npm', name: '@std/assert', version: '1.0.19' },
    vulnerabilities: [{ id: 'GHSA-x' }], groups: [{ ids: ['GHSA-x'], aliases: [], max_severity: '9.8' }] }] }] });
  const r = reviewRepo({ name: 'j', sbom: { components: [c] }, osv, osvState: 'checked' });
  assert.equal(r.components[0].vulns, null);
  assert.equal(r.vulns.rows.length, 0);
  assert.ok(r.findings.some((f) => f.level === 'unknown' && /JSR package or URL import not looked up/.test(f.title)));
});

test('severity: an empty score is unscored, never low', () => {
  assert.equal(severityBucket(''), 'unscored');
  assert.equal(severityBucket('2.7'), 'low');
  assert.equal(severityBucket('9.3'), 'critical');
});

test('storefront: every catalogued component is counted, the non-product ones classified', () => {
  const r = repo('storefront');
  assert.equal(r.totals.components, 16);
  assert.deepEqual(r.totals.byScope, { product: 10, 'local-only': 3, ci: 2, installed: 1 });
  assert.ok(findings('storefront').some((f) => f.area === 'scope' && f.level === 'medium'));
});

test('storefront: licence read from an installed package.json when the SBOM has none', () => {
  const react = repo('storefront').components.find((c) => c.name === 'react');
  assert.equal(react.licence, 'MIT');
  assert.equal(react.licenceSource, 'installed-package');
  const mystery = repo('storefront').components.find((c) => c.name === 'mystery-lib');
  assert.equal(mystery.licenceClass, 'unknown');
});

test('storefront: vulnerabilities split by scope; the tool binary\'s advisory is not a product finding', () => {
  const r = repo('storefront');
  assert.equal(r.vulns.productBySeverity.high, 1);
  assert.equal(r.vulns.productBySeverity.medium, 2);
  const xnet = r.vulns.rows.find((v) => v.name === 'golang.org/x/net');
  assert.equal(xnet.scope, 'local-only');
  assert.equal(xnet.severity, 'unscored');
  assert.deepEqual(r.vulns.rows.find((v) => v.id === 'GHSA-35jh-r3h4-6jhm').fixed, ['4.17.21']);
});

test('billing-api: not looked up is not clean', () => {
  const r = repo('billing-api');
  assert.equal(r.vulns.state, 'not-checked');
  assert.ok(r.components.every((c) => c.vulns === null));
  assert.ok(findings('billing-api').some((f) => f.level === 'unknown' && /not checked/i.test(f.title)));
  assert.ok(!findings('billing-api').some((f) => /No known vulnerabilities/.test(f.title)));
  assert.equal(review.summary.vulnsChecked, 1);
});

test('billing-api: a lockfile changed after the SBOM is stale; a tracked lockfile it never read is a gap, not a finding', () => {
  const r = repo('billing-api');
  assert.equal(r.lockfiles.find((l) => l.path === 'go.mod').changedAfterSbom, true);
  assert.equal(r.lockfiles.find((l) => l.path === 'web/package-lock.json').changedAfterSbom, false);
  assert.ok(findings('billing-api').some((f) => f.area === 'freshness' && f.level === 'medium'));
  const gap = findings('billing-api').find((f) => f.area === 'coverage');
  assert.equal(gap.level, 'unknown');
  assert.match(gap.detail, /scripts\/requirements\.txt/);
});

test('docs-site: no SBOM is not reviewed, never zero components, and the exit code says so', () => {
  const r = repo('docs-site');
  assert.equal(r.status, 'no-sbom');
  assert.equal(r.totals, undefined);
  assert.equal(review.summary.notReviewed, 1);
  assert.ok(review.findings.some((f) => f.repo === 'docs-site' && f.level === 'unknown'));
  assert.equal(code, 3);
});

test('group: version drift across repos', () => {
  assert.deepEqual(review.drift.map((d) => d.name), ['actions/checkout', 'lodash', 'react']);
  assert.deepEqual(review.drift.find((d) => d.name === 'react').repos, { 'billing-api': ['18.3.1'], storefront: ['18.2.0'] });
});

test('an unreadable SBOM is absent, not empty', async () => {
  const bad = join(tmp, 'bad-reports');
  mkdirSync(join(bad, 'b', 'storefront'), { recursive: true });
  writeFileSync(join(bad, 'b', 'storefront', 'sbom-syft.json'), '{ not json');
  const out = join(tmp, 'out-bad');
  const rc = await main(['--repo', fx.repos[0], '--reports', bad, '--out', out]);
  const g = JSON.parse(readFileSync(join(out, 'sbom-review.json'), 'utf8'));
  assert.equal(g.repos[0].status, 'no-sbom');
  assert.match(g.notes.join('\n'), /SBOM unreadable .* treated as absent, not empty/);
  assert.equal(rc, 3);
});

test('deterministic: the same inputs give byte-identical output', async () => {
  await run(join(tmp, 'out2'));
  for (const f of ['sbom-review.json', 'sbom-review.md', 'sbom-review.html']) {
    assert.equal(readFileSync(join(tmp, 'out2', f), 'utf8').replaceAll('out2', 'out'), readFileSync(join(tmp, 'out', f), 'utf8'), f);
  }
});

test('a remote URL import written as an npm purl is URL, never an npm lookup; a hashed file is not a package', () => {
  const url = { name: 'deno.land/std', version: '0.208.0', purl: 'pkg:npm/deno.land%2Fstd@0.208.0?repository_url=https%3A%2F%2Fdeno.land',
    properties: [{ name: 'syft:location:0:path', value: '/deno.lock' }] };
  assert.equal(ecosystemOf(url), 'URL');
  assert.equal(ecosystemOf({ purl: 'pkg:npm/a@1?repository_url=https%3A%2F%2Fregistry.npmjs.org' }), 'npm');
  const file = { type: 'file', name: '/c/repo/deno.lock', hashes: [] };
  const osv = indexOsv({ results: [{ packages: [{ package: { ecosystem: 'npm', name: 'deno.land/std', version: '0.208.0' },
    vulnerabilities: [{ id: 'X' }], groups: [{ ids: ['X'], aliases: [], max_severity: '9' }] }] }] });
  const r = reviewRepo({ name: 'u', sbom: { components: [url, file] }, osv, osvState: 'checked' });
  assert.equal(r.components.find((c) => c.ecosystem === 'URL').vulns, null);
  const f = r.components.find((c) => c.ecosystem === 'file');
  assert.equal(f.scope, 'source-file');
  assert.deepEqual(f.flags, []);
  assert.ok(!r.findings.some((x) => /not product dependencies/.test(x.title)));
});

test('inventory separates installations (versions) from instances (places one version is declared)', () => {
  const c = (name, version, location, provider = 'npm', entries = 1) => ({ name, version, location, provider, entries, scope: 'product', licence: 'MIT', vulns: [] });
  const inv = inventoryOf([
    { ...c('supabase-js', '2.108.2', 'site/deno.lock') }, { ...c('supabase-js', '2.118.0', 'worker/deno.lock') },
    { ...c('supabase-js', '2.118.0', 'scripts/deno.lock') }, { ...c('deno.land/std', '0.216.0', 'site/deno.lock', 'deno.land', 184) },
    { ...c('deno.land/std', '0.216.0', 'site/deno.lock', 'deno.land', 1) }, { ...c('x', '1', '', 'npm'), scope: 'source-file' },
  ]);
  assert.deepEqual(inv.map((p) => p.provider), ['deno.land', 'npm']);
  const sb = inv[1].packages[0];
  assert.equal(sb.installations, 2);
  assert.equal(sb.instances, 3);
  assert.deepEqual(sb.versions.map((v) => [v.version, v.instances.map((i) => i.location)]),
    [['2.108.2', ['site/deno.lock']], ['2.118.0', ['scripts/deno.lock', 'worker/deno.lock']]]);
  const std = inv[0].packages[0];
  assert.deepEqual([std.installations, std.instances, std.entries], [1, 1, 185]);
});

test('provider names the registry: esm.sh serves npm, deno.land is its own', () => {
  assert.equal(providerOf({ name: 'preact', purl: 'pkg:npm/preact@10.22.0?repository_url=https%3A%2F%2Fesm.sh' }), 'npm via esm.sh');
  assert.equal(providerOf({ name: 'deno.land/std', purl: 'pkg:npm/deno.land%2Fstd@0.216.0?repository_url=https%3A%2F%2Fdeno.land' }), 'deno.land');
  assert.equal(providerOf({ name: 'zod', purl: 'pkg:npm/zod@3.0.0' }), 'npm');
});

test('the HTML carries the inventory, sort keys and the inline sort/filter script', () => {
  const html = readFileSync(join(tmp, 'out', 'sbom-review.html'), 'utf8');
  assert.match(html, /Inventory by provider/);
  assert.match(html, /data-sort="2"/);
  assert.match(html, /id="filter-all"/);
  assert.match(html, /<script>\(\(\)=>\{/);
  assert.doesNotMatch(html, /<script src=/);
});
