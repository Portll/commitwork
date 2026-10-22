// bin/test/release-report.test.mjs — the release reporter, held to known documents and a pinned clock.
//
// Timestamps in fixtures/release-evidence/ are chosen so the exposure arithmetic can be done by hand.
// exposure.json: A serves 10-20 01:00-13:00 and 10-21 02:00-06:00, B 10-20 13:00 to 10-21 02:00 and
// is first seen blocked at 10-20 14:00 (12 h of exposure), C serves 10-21 06:00 to generated_at
// 10-22 10:00 (28 h) with a finding KEV-listed from 10-21.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  main, buildReport, judgeFinding, servingIntervals, validateEvidence, parseEvidence, fetchSource,
  loadSources, fmtSecs, renderHtml,
} from '../release-report.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const FX = join(ROOT, 'fixtures', 'release-evidence');
const fx = (n) => join(FX, `${n}.json`);
const NOW = '2026-10-22T12:00:00Z';
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

let tmp;
const KEYS = ['CW_NOW', 'CW_KEV', 'CW_EPSS', 'CW_ADVISORY_INDEX', 'CW_RELEASES_DIR', 'CW_RELEASE_SOURCES', 'CRA_KEV_STALE_DAYS', 'CW_KEV_STALE_DAYS'];
const saved = {};
before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cw-relrep-'));
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.CW_NOW = NOW;
  process.env.CW_KEV = fx('kev');
  process.env.CW_EPSS = fx('epss');
  process.env.CW_ADVISORY_INDEX = join(tmp, 'no-such-index.json');
  process.env.CW_RELEASES_DIR = join(tmp, 'store');
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(tmp, { recursive: true, force: true });
});

const run = async (args) => {
  let out = '';
  let err = '';
  const code = await main(args, { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
};
let n = 0;
const outDir = () => join(tmp, `out${n++}`);
const reportOf = async (name, extra = []) => {
  const o = outDir();
  const r = await run(['--evidence', fx(name), '--out', o, '--json', ...extra]);
  return { ...r, o, report: r.out ? JSON.parse(r.out) : null };
};

describe('input contract', () => {
  test('every valid fixture passes and the invalid one is refused with reasons', () => {
    for (const name of ['clean', 'serving-blocked', 'disagreement', 'exposure', 'stale']) {
      const { errors } = validateEvidence(JSON.parse(readFileSync(fx(name), 'utf8')));
      assert.deepEqual(errors, [], name);
    }
    const bad = validateEvidence(JSON.parse(readFileSync(fx('invalid'), 'utf8')));
    assert.ok(bad.errors.some((e) => /schema/.test(e)));
    assert.ok(bad.errors.some((e) => /serving/.test(e)));
    assert.ok(bad.errors.length >= 3);
  });

  test('cross-field facts a schema cannot say are refused', () => {
    const d = () => JSON.parse(readFileSync(fx('clean'), 'utf8'));
    const dup = d(); dup.releases.push(dup.releases[0]);
    assert.ok(validateEvidence(dup).errors.some((e) => /twice/.test(e)));
    const ghost = d(); ghost.serving = 'd'.repeat(40);
    assert.ok(validateEvidence(ghost).errors.some((e) => /not among releases/.test(e)));
    const date = d(); date.events[0].at = '2026-13-45T99:00:00Z';
    assert.ok(validateEvidence(date).errors.some((e) => /not a real date/.test(e)));
    const extra = d(); extra.surprise = 1;
    assert.ok(validateEvidence(extra).errors.some((e) => /unknown key/.test(e)));
    assert.ok(parseEvidence('{not json', 'x').errors[0].includes('not JSON'));
  });

  test('invalid, unreadable and mixed input exit 2 and write nothing', async () => {
    const o = outDir();
    const bad = await run(['--evidence', fx('invalid'), '--out', o]);
    assert.equal(bad.code, 2);
    assert.equal(existsSync(o), false);
    const mixed = await run(['--evidence', fx('clean'), '--evidence', fx('invalid'), '--out', o]);
    assert.equal(mixed.code, 2);
    assert.equal(existsSync(o), false, 'a valid document beside an invalid one is not reported');
    const gone = await run(['--evidence', join(tmp, 'nope.json'), '--out', o]);
    assert.equal(gone.code, 2);
    assert.equal(existsSync(o), false);
    assert.equal((await run([])).code, 2);
    assert.equal((await run(['--bogus'])).code, 2);
    assert.equal((await run(['--evidence'])).code, 2);
    assert.equal((await run(['--evidence', fx('clean'), '--evidence', fx('clean'), '--out', o])).code, 2, 'two documents for one product');
    assert.equal(existsSync(o), false);
  });
});

describe('timeline and exposure', () => {
  test('serving intervals: a serving event of another sha closes the last, a repeat is ignored, the last is open', () => {
    const ivs = servingIntervals(JSON.parse(readFileSync(fx('exposure'), 'utf8')));
    const h = (iv) => (iv.to - iv.from) / 3600_000;
    assert.deepEqual(ivs.get(A).map(h), [12, 4]);
    assert.deepEqual(ivs.get(B).map(h), [13]);
    assert.deepEqual(ivs.get(C).map(h), [28]);
    assert.equal(ivs.get(C)[0].open, true);
    assert.equal(ivs.get(A).some((iv) => iv.open), false);
  });

  test('exposure arithmetic from known timestamps', async () => {
    const { report } = await reportOf('exposure');
    const e = Object.fromEntries(report.exposure.releases.map((x) => [x.sha, x]));
    assert.equal(e[B].first_blocked_evidence.at, '2026-10-20T14:00:00Z');
    assert.equal(e[B].blocked_exposure_seconds, 12 * 3600, 'serving 14:00 to 02:00 after the first blocked event');
    assert.equal(e[B].kev_exposure_seconds, 13 * 3600, 'KEV added before it ever served, so all 13 h count');
    assert.equal(e[C].blocked_exposure_seconds, null, 'never blocked');
    assert.equal(e[C].kev_findings[0].date_added, '2026-10-21');
    assert.equal(e[C].kev_exposure_seconds, 28 * 3600);
    assert.equal(report.exposure.totals.blocked_exposure_seconds, 12 * 3600);
    assert.equal(report.exposure.totals.kev_exposure_seconds, 41 * 3600);
    assert.equal(report.timeline.find((t) => t.sha === A).serving_seconds, 16 * 3600);
    assert.deepEqual(report.timeline.map((t) => t.sha), [A, B, C], 'ordered by first serving');
    assert.deepEqual(report.history.map((x) => x.event), ['blocked', 'refused']);
  });

  test('fmtSecs', () => {
    assert.equal(fmtSecs(0), '0s');
    assert.equal(fmtSecs(43200), '12h');
    assert.equal(fmtSecs(90061), '1d 1h 1m');
    assert.equal(fmtSecs(null), 'unknown');
  });
});

describe('report and exit codes', () => {
  test('clean: exit 0, rollback-eligible honours verdict age, not-covered is stated, files written', async () => {
    const r = await reportOf('clean');
    assert.equal(r.code, 0);
    assert.equal(r.report.serving.sha, A);
    assert.equal(r.report.serving.verdict_status, 'clean');
    assert.deepEqual(r.report.rollback_eligible.map((x) => x.sha), [B], 'C is kept and clean but its verdict is 12 days old');
    assert.equal(r.report.not_covered.find((u) => u.sha === A).jsr, 3);
    assert.deepEqual(r.report.not_covered.find((u) => u.sha === A).remote_hosts, ['esm.sh']);
    assert.equal(r.report.second_opinion.performed, true);
    assert.deepEqual(r.report.second_opinion.disagreements, []);
    const html = readFileSync(join(r.o, 'audiencedirect-site', 'index.html'), 'utf8');
    assert.match(html, /prefers-color-scheme:dark/);
    assert.match(html, /id="not-covered"/);
    assert.match(html, /id="report-data"/);
    assert.doesNotMatch(html, /(?:src|href)="https?:/, 'file:// safe, nothing fetched');
    assert.deepEqual(JSON.parse(readFileSync(join(r.o, 'audiencedirect-site', 'report.json'), 'utf8')), r.report);
  });

  test('serving release blocked: exit 1', async () => {
    const r = await reportOf('serving-blocked');
    assert.equal(r.code, 1);
    assert.equal(r.report.serving.blocked, true);
    assert.equal(r.report.serving.blocking[0].package, 'evil-lib');
    assert.equal(r.report.second_opinion.epss_sources.commitwork, 1, 'EPSS taken from the local cache');
  });

  test('commitwork KEV lists a CVE the box did not mark: a disagreement, exit 1, both reasons given', async () => {
    const r = await reportOf('disagreement');
    assert.equal(r.code, 1);
    const [d] = r.report.second_opinion.disagreements;
    assert.equal(r.report.second_opinion.disagreements.length, 1);
    assert.equal(d.kind, 'commitwork-blocks-box-does-not');
    assert.equal(d.box.blocking, false);
    assert.equal(d.commitwork.blocking, true);
    assert.equal(d.commitwork.reason, 'listed in CISA KEV');
    assert.equal(d.commitwork.epss_source, 'none', 'no local score and the box had none');
    assert.equal(r.report.second_opinion.kev_flag_differences.length, 1);
    assert.equal(r.report.serving.blocked, true, 'commitwork would block the serving release');
  });

  test('stale evidence: exit 4', async () => {
    const r = await reportOf('stale');
    assert.equal(r.code, 4);
    assert.equal(r.report.evidence.stale, true);
    assert.equal(r.report.evidence.age_hours, 40);
    assert.match(readFileSync(join(r.o, 'audiencedirect-site', 'index.html'), 'utf8'), /stale/);
  });

  test('stale or missing KEV: exit 4, no agreement claimed; a known-bad serving release still exits 1', async () => {
    process.env.CW_KEV = fx('kev-stale');
    try {
      const clean = await reportOf('clean');
      assert.equal(clean.code, 4);
      assert.equal(clean.report.second_opinion.performed, false);
      assert.match(clean.report.second_opinion.reason, /no agreement is claimed/);
      const dis = await reportOf('disagreement');
      assert.deepEqual(dis.report.second_opinion.disagreements, [], 'nothing is claimed either way');
      assert.equal(dis.code, 4);
      assert.equal((await reportOf('serving-blocked')).code, 1);
      process.env.CW_KEV = join(tmp, 'absent-kev.json');
      const missing = await reportOf('clean');
      assert.equal(missing.code, 4);
      assert.equal(missing.report.kev.state, 'unknown');
    } finally { process.env.CW_KEV = fx('kev'); }
  });
});

describe('judgement under the declared policy', () => {
  const policy = { name: 'p', kev: true, critical: true, high_epss_min: 0.1, runtime_only: true };
  const finding = (o) => ({ id: 'GHSA-t', cves: ['CVE-2099-7000'], package: 'p', version: '1', runtime: true, severity: 'high', cvss: 7.5, epss: 0.01, kev: false, blocking: false, reason: '', ...o });
  const ctx = (o = {}) => ({ kev: new Set(), kevAdded: new Map(), epssDoc: {}, index: { advisories: {} }, byCve: new Map(), ...o });

  test('EPSS from the local cache overrides the box and is marked; the box value is kept when there is none', () => {
    const local = judgeFinding(finding(), policy, ctx({ epssDoc: { 'CVE-2099-7000': 0.9 } }));
    assert.equal(local.blocking, true);
    assert.equal(local.epss, 0.9);
    assert.equal(local.epss_source, 'commitwork');
    const box = judgeFinding(finding({ epss: 0.5 }), policy, ctx());
    assert.equal(box.blocking, true);
    assert.equal(box.epss_source, 'box');
  });

  test('unknown EPSS on a high finding does not block, and says why', () => {
    const j = judgeFinding(finding({ epss: null }), policy, ctx());
    assert.equal(j.blocking, false);
    assert.equal(j.epss_source, 'none');
    assert.match(j.reason, /EPSS unknown/);
  });

  test('CVSS the box lacked is scored from the advisory index', () => {
    const entry = { v3: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' };
    const j = judgeFinding(finding({ cvss: null, severity: 'unknown', id: 'GHSA-idx' }), policy, ctx({ index: { advisories: { 'GHSA-idx': entry } } }));
    assert.equal(j.cvss, 9.8);
    assert.equal(j.severity, 'critical');
    assert.equal(j.blocking, true);
    assert.match(j.cvss_source, /cvss scorer/);
    assert.equal(judgeFinding(finding({ cvss: 4.0, severity: 'low' }), policy, ctx({ index: { advisories: { 'GHSA-t': entry } } })).cvss_source, 'box', 'the box score stands when it has one');
  });

  test('runtime_only exempts a dev dependency, even a KEV-listed one', () => {
    const j = judgeFinding(finding({ runtime: false }), policy, ctx({ kev: new Set(['CVE-2099-7000']) }));
    assert.equal(j.blocking, false);
    assert.equal(j.kev, true);
    assert.equal(judgeFinding(finding({ runtime: false }), { ...policy, runtime_only: false }, ctx({ kev: new Set(['CVE-2099-7000']) })).blocking, true);
  });
});

describe('fetching', () => {
  const src = { product: 'audiencedirect-site', ssh: 'deploy@box.example', key: '/k/id' };
  const good = readFileSync(fx('clean'), 'utf8');

  test('ssh is invoked non-interactively with no remote command', async () => {
    let seen;
    const r = await fetchSource(src, async (args) => { seen = args; return { err: null, stdout: good, stderr: '' }; });
    assert.deepEqual(seen, ['-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-i', '/k/id', 'deploy@box.example']);
    assert.equal(r.doc.product, 'audiencedirect-site');
  });

  test('a failed ssh, an invalid document and a document for another product are errors, never documents', async () => {
    const fail = await fetchSource(src, async () => ({ err: Object.assign(new Error('x'), { code: 255 }), stdout: '', stderr: 'Permission denied\n' }));
    assert.match(fail.error, /ssh failed \(255\): Permission denied/);
    assert.match((await fetchSource(src, async () => ({ err: null, stdout: '{"schema":1}', stderr: '' }))).error, /schema|required/);
    assert.match((await fetchSource({ ...src, product: 'other' }, async () => ({ err: null, stdout: good, stderr: '' }))).error, /document for audiencedirect-site/);
  });

  test('sources are checked: no option smuggling through ssh, no path escape through product', () => {
    const write = (list) => { const p = join(tmp, `src${n++}.json`); writeFileSync(p, JSON.stringify(list)); return p; };
    assert.ok(loadSources(write([src])).sources);
    assert.ok(loadSources(write([{ ...src, ssh: '-oProxyCommand=x@y' }])).errors);
    assert.ok(loadSources(write([{ ...src, product: '../x' }])).errors);
    assert.ok(loadSources(write([{ ...src, key: '-i' }])).errors);
    assert.ok(loadSources(write([{ ...src, extra: 1 }])).errors);
    assert.equal(loadSources(write([{ ...src, key: '~/k' }])).sources[0].key, join(homedir(), 'k'));
    assert.ok(loadSources(join(ROOT, 'monitor', 'releases.example.json')).sources, 'the shipped example is a valid list');
    assert.ok(loadSources(write([])).errors);
    assert.ok(loadSources(join(tmp, 'absent.json')).errors);
  });

  test('--fetch stores each valid document, reports the failed source, still reports the others, exits 2', async () => {
    const list = join(tmp, 'sources.json');
    writeFileSync(list, JSON.stringify([src, { product: 'broken-site', ssh: 'deploy@down.example', key: '/k/id' }]));
    process.env.CW_RELEASE_SOURCES = list;
    const o = outDir();
    let out = '';
    let err = '';
    const code = await main(['--fetch', '--out', o], { out: (s) => { out += s; }, err: (s) => { err += s; } },
      async (args) => (args.includes('deploy@down.example')
        ? { err: Object.assign(new Error('x'), { code: 255 }), stdout: '', stderr: 'Connection refused\n' }
        : { err: null, stdout: good, stderr: '' }));
    delete process.env.CW_RELEASE_SOURCES;
    assert.equal(code, 2);
    assert.match(err, /fetch failed: broken-site/);
    const stored = readdirSync(join(process.env.CW_RELEASES_DIR, 'audiencedirect-site'));
    assert.equal(stored.length, 1);
    assert.match(stored[0], /^20261022T120000Z\.json$/);
    assert.equal(readFileSync(join(process.env.CW_RELEASES_DIR, 'audiencedirect-site', stored[0]), 'utf8'), good);
    assert.equal(existsSync(join(process.env.CW_RELEASES_DIR, 'broken-site')), false);
    assert.ok(existsSync(join(o, 'audiencedirect-site', 'index.html')));
    assert.equal(existsSync(join(o, 'broken-site')), false);
    assert.equal(out, '');
  });
});

describe('command line', () => {
  const cli = (args) => spawnSync(process.execPath, [join(ROOT, 'bin', 'release-report.mjs'), ...args], {
    encoding: 'utf8',
    env: { ...process.env },
  });

  test('runs as an entry point (the Windows path guard), prints the JSON and exits with the report code', () => {
    const o = outDir();
    const r = cli(['--evidence', fx('serving-blocked'), '--out', o, '--json']);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(JSON.parse(r.stdout).serving.sha, A);
    assert.ok(existsSync(join(o, 'audiencedirect-site', 'report.json')));
  });

  test('usage error is 2', () => {
    assert.equal(cli([]).status, 2);
  });

  test('the page escapes document text', () => {
    const doc = JSON.parse(readFileSync(fx('serving-blocked'), 'utf8'));
    doc.releases[0].verdict.blocking[0].reason = '<script>alert(1)</script>';
    doc.releases[0].verdict.findings[0].reason = '<script>alert(1)</script>';
    const html = renderHtml(buildReport(doc, { now: NOW, fresh: { state: 'fresh', ageDays: 1, maxDays: 7 }, kev: new Set(), kevAdded: new Map(), epssDoc: {}, index: { advisories: {} }, byCve: new Map() }));
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;alert/);
  });
});
