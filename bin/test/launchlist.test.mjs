// lib/launchlist*.mjs + bin/launchlist.mjs over a fixture repository built here. No network: the
// registry probes take an injected fetch, and site checks are exercised against a stub.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'cw-launchlist-'));
const FIX = join(TMP, 'fixrepo');
const STORE = join(TMP, 'store');
process.env.CW_LAUNCHLIST_DIR = STORE;
process.env.CW_LAUNCHLIST_HTML = join(TMP, 'out', 'index.html');
process.env.CW_NOW = '2026-09-18T00:00:00.000Z';

const L = await import('../../lib/launchlist.mjs');
const C = await import('../../lib/launchlist-checks.mjs');
const R = await import('../../lib/launchlist-render.mjs');
const CLI = await import('../launchlist.mjs');
const { buildScope } = await import('../lib/release-scope.mjs');

const IDENT = 'acmewidgets';
const g = (...a) => execFileSync('git', ['-C', FIX, ...a], { encoding: 'utf8' });

before(() => {
  mkdirSync(join(FIX, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(FIX, 'docs'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', FIX]);
  g('config', 'user.email', 'fixture@example.com');
  g('config', 'user.name', 'fixture');
  g('config', 'commit.gpgsign', 'false');
  writeFileSync(join(FIX, 'LICENSE'), '                    GNU AFFERO GENERAL PUBLIC LICENSE\n                       Version 3, 19 November 2007\n Copyright (C) 2007 Free Software Foundation, Inc.\n');
  writeFileSync(join(FIX, 'LICENSE-APACHE-2.0'), 'Apache License\nVersion 2.0\n\n   Copyright 2025 someone-else\n');
  writeFileSync(join(FIX, 'README.md'), '# fix\n[![crates](https://img.shields.io/crates/v/fixture-crate-zz.svg)](https://crates.io/crates/fixture-crate-zz)\n'
    + '[![docker](https://img.shields.io/docker/pulls/fixns/fiximg.svg)](https://hub.docker.com/r/fixns/fiximg)\n');
  writeFileSync(join(FIX, 'CLAUDE.md'), 'agent notes\n');
  writeFileSync(join(FIX, 'docs', 'notes.md'), `path /Users/x/work and bob@corp.io and ${IDENT.toUpperCase()} and ../siblingrepo/x\nsee ops@example.com\n`);
  // two spellings on ONE line: `git grep -c` would score this line once, which is the undercount
  writeFileSync(join(FIX, 'docs', 'other.md'), 'the Acme-Widgets and acme-widgets deal\n');
  // a prefix form and a publish-map name, both invisible to a literal grep over the release names;
  // the repository's own name and a prose name's exempt form are not occurrences
  writeFileSync(join(FIX, 'docs', 'svc.md'), 'fixrepo deploys hx-billing to blue_heron with NIMBUS_HOME set\n');
  writeFileSync(join(FIX, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0xff, 0x00]));
  writeFileSync(join(FIX, '.github', 'workflows', 'ci.yml'), 'on: pull_request_target\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: foo/bar@v1\n');
  mkdirSync(join(FIX, 'reports', IDENT), { recursive: true });
  writeFileSync(join(FIX, 'reports', IDENT, 'x.txt'), 'x\n');
  symlinkSync('../outside-store', join(FIX, 'store'));
  g('add', '-A');
  g('commit', '-q', '-m', 'fixture');
  writeFileSync(join(FIX, 'uncommitted.txt'), 'dirty\n');
});

after(() => rmSync(TMP, { recursive: true, force: true }));

const notFound = async () => ({ status: 404, json: async () => ({}), text: async () => '', headers: new Map() });

function ctxFor(extra = {}) {
  return {
    project: 'fixrepo', repo: FIX, repoName: 'fixrepo', accounts: {},
    cfg: { copyrightHolders: ['Portll'], ...(extra.cfg || {}) },
    nameScope: buildScope({
      release: { names: [{ name: 'acme-widgets', replacement: 'clientZ', scope: 'all' }, { name: 'fixrepo', replacement: 'x', scope: 'all' }, { name: 'nimbus', replacement: 'layerZ', scope: 'prose', exempt: ['NIMBUS_'] }] },
      publish: { map: { 'blue-heron': 'internalZ' } },
      identities: { identities: [{ repo_name: IDENT, repo_aliases: ['hx-'], scope: 'all' }] },
    }),
    fleetNames: ['siblingrepo', 'fixrepo'], flags: {}, fetch: notFound, ...extra,
  };
}

describe('spec', () => {
  test('the shipped spec validates, and every measured item names a check that exists', () => {
    const spec = L.loadSpec();
    const missing = spec.items.filter((i) => i.check && !C.CHECKS[i.check]).map((i) => `${i.id}: ${i.check}`);
    assert.deepEqual(missing, []);
    const unused = Object.keys(C.CHECKS).filter((k) => !spec.items.some((i) => i.check === k));
    assert.deepEqual(unused, [], 'a check no item uses is dead code');
  });

  test('an invalid spec is refused through the schema, not loaded', () => {
    const bad = JSON.parse(readFileSync(join(REPO, 'manifests', 'launchlist.json'), 'utf8'));
    bad.items[0].severity = 'MAYBE';
    const p = join(TMP, 'bad-spec.json');
    writeFileSync(p, JSON.stringify(bad));
    assert.throws(() => L.loadSpec(p), /rejected by .*launchlist\.schema\.json/);
  });

  test('an item placed in a section its profile does not carry is refused', () => {
    const bad = JSON.parse(readFileSync(join(REPO, 'manifests', 'launchlist.json'), 'utf8'));
    bad.items[0].section = 'app';
    const p = join(TMP, 'bad-section.json');
    writeFileSync(p, JSON.stringify(bad));
    assert.throws(() => L.loadSpec(p), /is not in profile/);
  });
});

describe('checks over a fixture repository', () => {
  let r;
  before(async () => {
    const spec = L.loadSpec();
    const items = spec.items.filter((i) => L.profilesOf(i).includes('publication'));
    r = await C.runChecks(ctxFor(), items);
  });

  const st = (id) => r[id] && r[id].status;

  test('licence recognised; a foreign copyright holder fails', () => {
    assert.equal(st('pub.licence.file'), 'pass');
    assert.match(r['pub.licence.file'].summary, /AGPL-3\.0/);
    assert.equal(st('pub.licence.holders'), 'fail');
    assert.ok(r['pub.licence.holders'].evidence.some((e) => /LICENSE-APACHE-2\.0:4 — someone-else/.test(e)));
    assert.equal(st('pub.licence.terms'), 'fail');
  });

  test('names are counted with the release gates\' matcher and scope, reported only by scope document', () => {
    assert.equal(st('pub.private.identities'), 'fail');
    assert.equal(r['pub.private.identities'].summary, '6 name occurrence(s) at HEAD: 5 in 3 file(s), 1 in paths');
    assert.deepEqual(r['pub.private.identities'].evidence, [
      'release-manifest name: 3 in 2 file(s) — docs/other.md 2, docs/notes.md 1',
      'identity-register prefix: 1 in 1 file(s) — docs/svc.md 1',
      'publish-map name: 1 in 1 file(s) — docs/svc.md 1',
      '1 path(s) carry a name — reports/‹release-manifest›/x.txt',
    ], 'occurrences, not matching lines; separator variants are one name');
    const ev = r['pub.private.identities'].evidence.join('\n').toLowerCase();
    for (const name of ['acme-widgets', IDENT, 'hx-billing', 'blue', 'nimbus']) assert.ok(!ev.includes(name), `evidence must never carry ${name}`);
  });

  test('no identity list is UNMEASURED, never a pass', async () => {
    const out = await C.CHECKS.identities(ctxFor({ nameScope: null }));
    assert.equal(out.status, 'unmeasured');
  });

  test('home paths, addresses, symlinks, binaries, agent files and sibling references are found', () => {
    assert.equal(st('pub.private.paths'), 'warn');
    assert.equal(st('pub.private.emails'), 'warn');
    assert.deepEqual(r['pub.private.emails'].evidence, ['b***@corp.io ×1'], 'example.com is benign; the address is masked');
    assert.equal(st('pub.private.symlinks'), 'fail');
    assert.match(r['pub.private.symlinks'].evidence[0], /^store → \.\.\/outside-store$/);
    assert.equal(st('pub.private.assets'), 'warn');
    assert.match(r['pub.private.assets'].evidence[0], /^logo\.png/);
    assert.equal(st('pub.private.agents'), 'warn');
    assert.equal(st('pub.private.siblings'), 'fail');
  });

  test('unsafe workflows fail; README badges for packages that do not exist fail', () => {
    assert.equal(st('pub.gh.workflows'), 'fail');
    assert.ok(r['pub.gh.workflows'].evidence.some((e) => /pull_request_target/.test(e)));
    assert.ok(r['pub.gh.workflows'].evidence.some((e) => /foo\/bar@v1 not pinned/.test(e)));
    assert.equal(st('pub.repo.badges'), 'fail');
    assert.deepEqual(r['pub.repo.badges'].evidence, ['crates fixture-crate-zz: free', 'docker fixns/fiximg: free'],
      'a shields image and its link are one package, without the .svg suffix');
  });

  test('presence checks and the working tree', () => {
    assert.equal(st('pub.repo.readme'), 'pass');
    assert.equal(st('pub.repo.security'), 'fail');
    assert.equal(st('pub.repo.contributing'), 'fail');
    assert.equal(st('pub.repo.dirty'), 'warn');
  });

  test('opt-in and undeclared checks say why they did not run', () => {
    assert.equal(st('pub.secrets.history'), 'unmeasured');
    assert.match(r['pub.secrets.history'].summary, /--history/);
    assert.equal(st('pub.build.public-test'), 'unmeasured');
    assert.equal(st('pub.decide.names'), 'unmeasured');
  });

  test('a check that throws is UNMEASURED with its reason', async () => {
    const out = await C.runChecks({ ...ctxFor(), repo: join(TMP, 'no-such-repo') }, [{ id: 'x', check: 'readme' }]);
    assert.equal(out.x.status, 'unmeasured');
    assert.match(out.x.summary, /check failed to run/);
  });
});

// A one-commit repository built per test, so the two directions of each judgement are asserted over
// inputs that differ in exactly the thing being judged.
function tinyRepo(files) {
  const dir = mkdtempSync(join(TMP, 'tiny-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  g('config', 'user.email', 'fixture@example.com'); g('config', 'user.name', 'fixture');
  g('config', 'commit.gpgsign', 'false');
  g('add', '-A'); g('commit', '-q', '-m', 'tiny');
  return dir;
}
const tinyCtx = (repo, cfg = {}) => ({ repo, repoName: 'tinyrepo', cfg, accounts: {}, fleetNames: ['sibling-repo'], flags: {} });

describe('siblingRefs resolves the reference instead of matching its tail', () => {
  test('../../name from a file two deep is THIS repository and is not a sibling dependency', async () => {
    // The in-repo direction. `sibling-repo/` is tracked here, so the specifier names a shipped file.
    const repo = tinyRepo({ 'sibling-repo/serve.mjs': 'export const x = 1;\n', 'a/b/use.mjs': "import { x } from '../../sibling-repo/serve.mjs';\n" });
    const out = await C.CHECKS.siblingRefs(tinyCtx(repo));
    assert.equal(out.status, 'pass', `reported ${out.summary}`);
    assert.match(out.summary, /1 in-repo reference\(s\) exempt .*sibling-repo/);
  });

  test('a reference that leaves the root, and one that lands where nothing is tracked, still FAIL', async () => {
    const repo = tinyRepo({
      'note.md': 'reads ../sibling-repo/data.json\n',                     // leaves the root entirely
      'monitor/reg.json': '{ "path": "../sibling-repo/documents/x.json" }\n',  // inside, nothing tracked there
    });
    const out = await C.CHECKS.siblingRefs(tinyCtx(repo));
    assert.equal(out.status, 'fail');
    assert.match(out.summary, /^2 reference\(s\) to sibling repositories in 2 file\(s\)/);
    assert.deepEqual(out.evidence, ['monitor/reg.json 1', 'note.md 1']);
  });

  test('a fleet too large for one regex is still measured, and a reference to any member is found', async () => {
    const fleet = Array.from({ length: 3000 }, (_, i) => `corpus-owner-${i}_a-long-repository-name-with-words-${i}`);
    const repo = tinyRepo({ 'note.md': `reads ../${fleet[1234]}/data.json\n` });
    const out = await C.CHECKS.siblingRefs({ ...tinyCtx(repo), fleetNames: fleet });
    assert.equal(out.status, 'fail', `reported ${out.summary}`);
    assert.deepEqual(out.evidence, ['note.md 1']);
  });
});

describe('absolutePaths separates the publisher\'s own home from a synthetic fixture path', () => {
  test('a path naming THIS machine\'s home is the finding, and it says so', async () => {
    const repo = tinyRepo({ 'doc.md': `see ${userInfo().homedir}/work/thing\n` });
    const out = await C.CHECKS.absolutePaths(tinyCtx(repo));
    assert.equal(out.status, 'warn');
    assert.match(out.summary, /^1 path\(s\) name this machine's home in 1 file\(s\)/);
  });

  test('a fixture path naming no account here is reported apart, never folded into the first count', async () => {
    const repo = tinyRepo({ 'test/fix.mjs': "assert.equal(redact('/Users/x/a'), '/Users/username/a');\n" });
    const out = await C.CHECKS.absolutePaths(tinyCtx(repo));
    assert.equal(out.status, 'warn');
    assert.match(out.summary, /^no path names this machine's home; 2 home-shaped path\(s\) in 1 file\(s\)/);
  });

  test('homePrefixes is read at call time, so a declared home moves a path into the first bucket', async () => {
    const repo = tinyRepo({ 'test/fix.mjs': "const p = '/Users/x/a';\n" });
    assert.match((await C.CHECKS.absolutePaths(tinyCtx(repo, { homePrefixes: ['/Users/x'] }))).summary,
      /^1 path\(s\) name this machine's home/);
    assert.match((await C.CHECKS.absolutePaths(tinyCtx(repo))).summary, /^no path names this machine's home/);
  });

  test('a repository with no home-shaped path at all passes', async () => {
    const out = await C.CHECKS.absolutePaths(tinyCtx(tinyRepo({ 'a.md': 'relative paths only\n' })));
    assert.equal(out.status, 'pass');
  });
});

describe('site checks against a stub', () => {
  const page = '<!doctype html><html lang="en"><head><title>T</title><meta name="description" content="d"><meta name="viewport" content="w">'
    + '<link rel="canonical" href="https://s.test/"><meta property="og:title" content="t"><meta property="og:description" content="d">'
    + '<script src="https://cdn.other.test/x.js"></script></head><body><a href="/privacy">Privacy</a></body></html>';
  const stub = async (url, opts = {}) => {
    const u = new URL(url);
    const headers = new Map(Object.entries(u.protocol === 'http:' ? { location: 'https://s.test/' } : { 'strict-transport-security': 'max-age=1', 'x-content-type-options': 'nosniff' }));
    const h = { get: (k) => headers.get(k) || null };
    if (u.protocol === 'http:') return { status: 301, url, headers: h, text: async () => '' };
    if (u.pathname === '/') return { status: 200, url, headers: h, text: async () => page };
    if (u.pathname === '/robots.txt') return { status: 200, url, headers: h, text: async () => 'User-agent: *\n' };
    return { status: 200, url, headers: h, text: async () => '<html>soft</html>' };
  };
  const sctx = () => ctxFor({ cfg: { site: 'https://s.test/' }, fetch: stub });

  test('headers, meta, social, crawl, 404, third-party and privacy', async () => {
    const c = sctx();
    assert.equal((await C.CHECKS.siteReach(c)).status, 'pass');
    assert.equal((await C.CHECKS.siteHttps(c)).status, 'pass');
    const hd = await C.CHECKS.siteHeaders(c);
    assert.equal(hd.status, 'warn');
    assert.deepEqual(hd.evidence, ['content-security-policy', 'referrer-policy', 'x-frame-options or CSP frame-ancestors']);
    assert.equal((await C.CHECKS.siteMeta(c)).status, 'pass');
    assert.deepEqual((await C.CHECKS.siteSocial(c)).evidence, ['og:image']);
    assert.equal((await C.CHECKS.siteCrawl(c)).status, 'warn');
    assert.equal((await C.CHECKS.site404(c)).status, 'fail', 'a 200 on an unknown path is a soft 404');
    assert.deepEqual((await C.CHECKS.siteThirdParty(c)).evidence, ['https://cdn.other.test']);
    assert.equal((await C.CHECKS.sitePrivacyLink(c)).status, 'pass');
  });

  test('no site declared is UNMEASURED', async () => {
    assert.equal((await C.CHECKS.siteMeta(ctxFor())).status, 'unmeasured');
  });
});

describe('evaluation: ticks and acceptances', () => {
  const spec = () => L.loadSpec();
  const config = { projects: { fixrepo: { profiles: ['publication'] } }, defaults: {} };

  test('a manual tick is done; a measured item is done only by passing or by an acceptance on the same evidence', () => {
    L.saveResults('fixrepo', { project: 'fixrepo', measuredAt: 'm', repo: { path: FIX }, results: {
      'pub.repo.security': { status: 'fail', summary: 'no SECURITY.md', evidence: [] },
      'pub.repo.readme': { status: 'pass', summary: 'README.md present', evidence: [] },
    } });
    const state = L.emptyState();
    assert.ok(L.recordTick(state, 'fixrepo', 'pub.decide.history', { by: 'op', spec: spec(), config }).ok);
    assert.ok(L.recordTick(state, 'fixrepo', 'pub.repo.security', { by: 'op', note: 'lands next', spec: spec(), config }).ok);
    let ev = L.evaluateProject('fixrepo', { spec: spec(), config, state, results: L.loadResults('fixrepo') });
    const row = (id) => ev.rows.find((x) => x.id === id);
    assert.equal(row('pub.decide.history').done, true);
    assert.equal(row('pub.repo.readme').done, true);
    assert.equal(row('pub.repo.security').accepted, true);
    assert.equal(row('pub.repo.security').done, true);

    L.saveResults('fixrepo', { project: 'fixrepo', measuredAt: 'm2', repo: { path: FIX }, results: {
      'pub.repo.security': { status: 'fail', summary: 'no SECURITY.md anywhere', evidence: [] },
    } });
    ev = L.evaluateProject('fixrepo', { spec: spec(), config, state, results: L.loadResults('fixrepo') });
    assert.equal(row('pub.repo.security').lapsed, true, 'changed evidence voids the acceptance');
    assert.equal(row('pub.repo.security').done, false);
    assert.equal(row('pub.repo.readme').done, false, 'a check with no result in the last run is unmeasured, not done');
  });

  test('an acceptance cannot green an unmeasured check; n/a can', () => {
    L.saveResults('fixrepo', { project: 'fixrepo', measuredAt: 'm3', repo: { path: FIX }, results: {
      'pub.decide.names': { status: 'unmeasured', summary: 'no names', evidence: [] },
      'pub.build.public-test': { status: 'unmeasured', summary: 'not run', evidence: [] },
    } });
    const state = L.emptyState();
    L.recordTick(state, 'fixrepo', 'pub.decide.names', { by: 'op', state: 'na', spec: spec(), config });
    L.recordTick(state, 'fixrepo', 'pub.build.public-test', { by: 'op', state: 'done', spec: spec(), config });
    const ev = L.evaluateProject('fixrepo', { spec: spec(), config, state, results: L.loadResults('fixrepo') });
    assert.equal(ev.rows.find((x) => x.id === 'pub.decide.names').done, true);
    assert.equal(ev.rows.find((x) => x.id === 'pub.build.public-test').done, false);
  });

  test('ticks refuse unknown items, bad states and anonymous callers', () => {
    const state = L.emptyState();
    assert.equal(L.recordTick(state, 'fixrepo', 'nope', { by: 'op', spec: spec(), config }).refused, 'no-subject');
    assert.equal(L.recordTick(state, 'fixrepo', 'pub.decide.history', { by: 'op', state: 'maybe', spec: spec(), config }).refused, 'invalid');
    assert.equal(L.recordTick(state, 'fixrepo', 'pub.decide.history', { by: '', spec: spec(), config }).refused, 'no-identity');
    assert.throws(() => L.recordTick(state, '../etc', 'pub.decide.history', { by: 'op', spec: spec(), config }), /not a project slug/);
  });

  test('project items join the list and refuse spec ids and bad fields', () => {
    const state = L.emptyState();
    assert.ok(L.addItem(state, 'fixrepo', { id: 'fx.one', section: 'secrets', severity: 'HARD', owner: 'engineering', size: 'S', title: 'rotate the thing' }, { spec: spec(), by: 'op' }).ok);
    assert.equal(L.addItem(state, 'fixrepo', { id: 'pub.repo.readme', section: 'repo', severity: 'HARD', owner: 'engineering', size: 'S', title: 't' }, { spec: spec(), by: 'op' }).ok, false);
    assert.equal(L.addItem(state, 'fixrepo', { id: 'fx.two', section: 'nowhere', severity: 'HARD', owner: 'engineering', size: 'S', title: 't' }, { spec: spec(), by: 'op' }).ok, false);
    const ids = L.itemsFor('fixrepo', { spec: spec(), config, state }).map((i) => i.id);
    assert.ok(ids.includes('fx.one'));
  });

  test('a corrupt state file fails closed instead of resetting the ledger', () => {
    mkdirSync(STORE, { recursive: true });
    writeFileSync(L.statePath(), '{not json');
    assert.throws(() => L.loadState(), /not valid JSON/);
    assert.throws(() => L.withState(() => ({ ok: true })), /not valid JSON/);
    assert.equal(readFileSync(L.statePath(), 'utf8'), '{not json', 'the corrupt file is left for a human, not overwritten');
  });
});

describe('render', () => {
  test('deterministic, escaped, and the CSP admits exactly the inline style and script', () => {
    rmSync(L.statePath(), { force: true });
    const state = L.emptyState();
    // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
    L.addItem(state, 'fixrepo', { id: 'fx.xss', section: 'repo', severity: 'HARD', owner: 'engineering', size: 'S', title: '<script>alert(1)</script>' }, { spec: L.loadSpec(), by: 'op' });
    const model = L.buildModel({ config: { projects: { fixrepo: {} }, defaults: { profiles: ['publication'] } }, state });
    const a = R.renderPage(model, { interactive: true });
    const b = R.renderPage(model, { interactive: true });
    assert.equal(a.html, b.html);
    // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
    assert.ok(!a.html.includes('<script>alert(1)</script>'));
    assert.ok(a.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    const style = a.html.match(/<style>([\s\S]*?)<\/style>/)[1];
    const scripts = [...a.html.matchAll(/<script>([\s\S]*?)<\/script\b[^>]*>/gi)].map((m) => m[1]);
    const h = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
    assert.ok(a.csp.includes(`'sha256-${h(style)}'`));
    assert.equal(scripts.length, 2, 'the theme follower and the page script');
    for (const script of scripts) assert.ok(a.csp.includes(`'sha256-${h(script)}'`));
    assert.match(a.csp, /default-src 'none'/);
  });
});

describe('cli', () => {
  test('parseArgs refuses a value flag with no value', () => {
    assert.match(CLI.parseArgs(['tick', 'p', 'i', '--note']).error, /--note needs a value/);
    assert.deepEqual(CLI.parseArgs(['run', '--project', 'a,b', '--tests']).flags, { project: 'a,b', tests: true });
  });

  test('tick, status and exit codes', async () => {
    rmSync(L.statePath(), { force: true });
    writeFileSync(L.configPath(), JSON.stringify({ projects: { fixrepo: { repo: FIX, profiles: ['featureset'] } } }));
    process.env.CW_LAUNCHLIST_BY = 'cli:test';
    const log = console.log;
    console.log = () => {};
    try {
      assert.equal(await CLI.main(['status']), 1, 'open HARD items exit 1');
      for (const id of ['feat.census', 'feat.core', 'feat.fragments']) assert.equal(await CLI.main(['tick', 'fixrepo', id]), 0);
      assert.equal(await CLI.main(['status']), 0);
      assert.equal(await CLI.main(['tick', 'fixrepo', 'no.such.item']), 2);
    } finally { console.log = log; }
    const st = JSON.parse(readFileSync(L.statePath(), 'utf8'));
    assert.equal(st.ticks.fixrepo['feat.core'].by, 'cli:test');
    assert.ok(existsSync(process.env.CW_LAUNCHLIST_HTML));
  });
});

// A CRLF licence file is the case the holders check was blind to: `git show` hands back bytes, so
// every line keeps a trailing \r, which `.` does not match and an unflagged `$` does not tolerate.
// The tree's own only CRLF licence file is a correct notice, so the defect hid nothing on the day it
// was found — which is exactly why the check needed a floor rather than a streak. The fixture is
// built CRLF on purpose and the first test asserts it stayed that way.
describe('copyright holders in a CRLF licence file', () => {
  const CRLF = join(TMP, 'crlfrepo');
  const cg = (...a) => execFileSync('git', ['-C', CRLF, ...a], { encoding: 'utf8' });
  const atHead = (path) => execFileSync('git', ['-C', CRLF, 'show', `HEAD:${path}`], { encoding: 'utf8' });

  before(() => {
    mkdirSync(CRLF, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', CRLF]);
    cg('config', 'user.email', 'fixture@example.com');
    cg('config', 'user.name', 'fixture');
    cg('config', 'commit.gpgsign', 'false');
    // a global autocrlf or text attribute would normalise the fixture and erase what it tests
    cg('config', 'core.autocrlf', 'false');
    writeFileSync(join(CRLF, '.gitattributes'), '* -text\n');
    writeFileSync(join(CRLF, 'LICENSE'), 'MIT License\r\nCopyright (c) 2026 Portll\r\n');
    writeFileSync(join(CRLF, 'LICENSE-UPSTREAM.txt'),
      'Copyright \u00a9 2017 Upstream Fonts Inc. with Reserved Font Name "Glyph"\r\nSIL OPEN FONT LICENSE\r\n');
    cg('add', '-A');
    cg('commit', '-q', '-m', 'crlf fixture');
  });

  const crlfCtx = (cfg) => ({ project: 'crlfrepo', repo: CRLF, repoName: 'crlfrepo', accounts: {}, cfg, flags: {}, fetch: notFound });

  test('the fixture is still CRLF at HEAD, or the two tests below prove nothing', () => {
    for (const f of ['LICENSE', 'LICENSE-UPSTREAM.txt']) assert.match(atHead(f), /\r\n/, `${f} lost its CRLF`);
  });

  test('an unexpected holder in a CRLF file is FOUND, not invisible', async () => {
    const r = await C.CHECKS.copyrightHolders(crlfCtx({ copyrightHolders: ['Portll'] }));
    assert.equal(r.status, 'fail');
    assert.match(r.summary, /^1 copyright line\(s\) name an unexpected holder$/);
    assert.deepEqual(r.evidence, ['LICENSE-UPSTREAM.txt:1 \u2014 Upstream Fonts Inc. with Reserved Font Name "Glyph"']);
  });

  test('a declared upstream holder in a CRLF file passes, and both CRLF lines are counted', async () => {
    const r = await C.CHECKS.copyrightHolders(crlfCtx({ copyrightHolders: ['Portll'], upstreamHolders: ['Upstream Fonts Inc'] }));
    assert.equal(r.status, 'pass');
    assert.match(r.summary, /^2 copyright line\(s\), all expected holders$/);
    assert.deepEqual(r.evidence.slice().sort(), [
      'LICENSE-UPSTREAM.txt:1 \u2014 Upstream Fonts Inc. with Reserved Font Name "Glyph"',
      'LICENSE:2 \u2014 Portll',
    ]);
  });
});

describe('githubExposure evidence survives a CI run', () => {
  // A stub gh answering each API path from env, so two runs differ in exactly one count.
  const stub = join(TMP, 'gh-stub.mjs');
  writeFileSync(stub, `#!/usr/bin/env node
const a = process.argv.slice(2).join(' ');
const e = process.env;
const out = a.includes('--jq .visibility') ? 'private'
  : a.includes('/branches') ? e.STUB_BRANCHES
  : a.includes('/actions/runs') ? e.STUB_RUNS
  : a.includes('/actions/artifacts') ? '0'
  : a.includes('/tags') || a.includes('/releases') ? '0'
  : '0';
process.stdout.write(String(out) + '\\n');
`, { mode: 0o755 });
  const measure = async (runs, branches) => {
    const prev = { gh: process.env.CW_GH, r: process.env.STUB_RUNS, b: process.env.STUB_BRANCHES };
    Object.assign(process.env, { CW_GH: stub, STUB_RUNS: String(runs), STUB_BRANCHES: String(branches) });
    try { return await C.CHECKS.githubExposure({ repo: TMP, cfg: { github: 'o/r' } }); }
    finally {
      for (const [k, v] of [['CW_GH', prev.gh], ['STUB_RUNS', prev.r], ['STUB_BRANCHES', prev.b]]) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  };

  test('another Actions run leaves the digest an acceptance is bound to unchanged', async () => {
    const a = await measure(522, 14);
    const b = await measure(531, 14);
    assert.equal(a.status, 'warn');
    assert.equal(L.digestEvidence(a), L.digestEvidence(b));
  });

  test('a new branch still changes it, and no run history at all still reads differently', async () => {
    const base = L.digestEvidence(await measure(522, 14));
    assert.notEqual(L.digestEvidence(await measure(522, 15)), base);
    assert.notEqual(L.digestEvidence(await measure(0, 14)), base);
  });
});

describe('publicTest runs where a public clone would', () => {
  test('the export is a git repository with exactly one root commit', async () => {
    const repo = tinyRepo({ 'a.md': 'x\n', 'b/c.md': 'y\n' });
    const ctx = { ...tinyCtx(repo, { publicTest: { cmd: 'git', args: ['rev-list', '--count', 'HEAD'] } }), flags: { tests: true } };
    const out = await C.CHECKS.publicTest(ctx);
    assert.equal(out.status, 'pass', `${out.summary}\n${(out.evidence || []).join('\n')}`);
    assert.deepEqual(out.evidence.filter(Boolean), ['1']);
  });

  test('a failing suite reports its counts and failing names, not npm\'s notice', async () => {
    const repo = tinyRepo({ 'a.md': 'x\n' });
    const spec = ['✔ a passes (1.2ms)', '✖ b breaks (2ms)', 'ℹ tests 2', 'ℹ pass 1', 'ℹ fail 1', 'ℹ skipped 0',
      '✖ failing tests:', '✖ b breaks (2ms)', 'npm notice New major version of npm available!'].join('\n');
    const script = `process.stdout.write(${JSON.stringify(spec)}); process.exit(1)`;
    const ctx = { ...tinyCtx(repo, { publicTest: { cmd: process.execPath, args: ['-e', script] } }), flags: { tests: true } };
    const out = await C.CHECKS.publicTest(ctx);
    assert.equal(out.status, 'fail');
    assert.match(out.summary, /exited 1 from a clean export \(1 of 2 failed\)$/);
    assert.equal(out.evidence[0], '2 tests · 1 pass · 1 fail · 0 skipped');
    assert.equal(out.evidence[1], 'b breaks');
    assert.equal(out.evidence.filter((e) => e === 'b breaks').length, 1, 'a name listed twice by the reporter is one row');
    assert.ok(!out.evidence.some((e) => /npm notice/.test(e)));
    assert.ok(!out.evidence.includes('failing tests:'), 'the reporter\'s header is not a test name');
  });
});

describe('the HEAD export fails closed', () => {
  test('a repository with no commit is unmeasured, never an empty export that scans clean', async (t) => {
    const repo = mkdtempSync(join(TMP, 'no-head-'));
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    writeFileSync(join(repo, 'a.md'), 'x\n');
    const stub = join(TMP, 'gitleaks-stub.mjs');
    writeFileSync(stub, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nconst a = process.argv;\nconst i = a.indexOf('--report-path');\nif (i > 0) writeFileSync(a[i + 1], '[]');\n`);
    chmodSync(stub, 0o755);
    const prev = process.env.CW_GITLEAKS;
    process.env.CW_GITLEAKS = stub;
    t.after(() => { if (prev === undefined) delete process.env.CW_GITLEAKS; else process.env.CW_GITLEAKS = prev; });
    const out = await C.runChecks(tinyCtx(repo), [{ id: 'head', check: 'secretsHead' }]);
    assert.equal(out.head.status, 'unmeasured', `${out.head.status}: ${out.head.summary}`);
  });
});

describe('registry probes', () => {
  test('an npm name is one path segment in the registry URL, whatever it carries', async () => {
    const urls = [];
    const fetch = async (u) => { urls.push(u); return { status: 404, json: async () => ({}) }; };
    for (const name of ['@scope/pkg', 'a/b?c#d']) await C.probePackage({ ...tinyCtx(null), fetch }, 'npm', name);
    assert.deepEqual(urls, ['https://registry.npmjs.org/@scope%2Fpkg', 'https://registry.npmjs.org/a%2Fb%3Fc%23d']);
  });
});
