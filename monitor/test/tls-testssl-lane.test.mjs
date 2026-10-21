// node --test monitor/test/tls-testssl-lane.test.mjs — tls-testssl's graded rows reach the rollup at
// testssl's own grade, WARN is undetermined, and a scan that failed is a void, never a clean zero.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _testsslCounts, SCANNER_SPECS, TOTALS_EXCLUDE, kindOf } from '../extractors.mjs';
import { identityFor, validateRows, panelSchema } from '../detail-schema.mjs';
import { scannerIdentityParts } from '../issue-store.mjs';
import { derivedLaneTabs } from '../lane-tabs.mjs';
import { LANE_ROSTER, OFF_SPEC_LANES } from '../lane-roster.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(CW, 'monitor', 'test', 'fixtures', 'lane-capability', 'tlsTestssl');
const FILE = 'testssl-full.json';
const RAW = JSON.parse(readFileSync(join(FIXTURE, FILE), 'utf8'));
const GRADED = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const BUCKET = { CRITICAL: 'crit', HIGH: 'high', MEDIUM: 'med', LOW: 'low' };
const scratch = () => mkdtempSync(join(tmpdir(), 'cw-testssl-lane-'));
const write = (rows) => { const d = scratch(); writeFileSync(join(d, FILE), typeof rows === 'string' ? rows : JSON.stringify(rows)); return d; };
const at = { ip: 'tls.example.invalid/192.0.2.10', port: '443' };

describe('the synthetic fixture', () => {
  const c = _testsslCounts(FIXTURE, FILE);

  test('20 graded rows: 19 published at their grade, overall_grade carried as the grade', () => {
    assert.equal(RAW.filter((r) => GRADED.has(r.severity)).length, 20, 'the fixture changed under this test');
    assert.deepEqual({ crit: c.crit, high: c.high, med: c.med, low: c.low, total: c.total, undetermined: c.undetermined },
      { crit: 1, high: 5, med: 1, low: 12, total: 19, undetermined: 1 });
    assert.equal(c.findings.length, c.total, 'rows and count agree (monitor/conserve.mjs)');
    assert.deepEqual(c.grades, [{ host: 'localhost', port: '18443', grade: 'T', claimedSeverity: 'crit' }]);
    assert.ok(!c.findings.some((f) => f.rule === 'overall_grade'));
    assert.deepEqual(validateRows('tlsTestssl', c.findings), []);
  });

  test('no row is published above the grade testssl gave it, and crit/high only from HIGH/CRITICAL', () => {
    const given = new Map(RAW.map((r) => [`${r.id}|${r.port}`, r.severity]));
    for (const f of c.findings) {
      const sev = given.get(`${f.rule}|${f.port}`);
      assert.equal(f.sev, BUCKET[sev], `${f.rule}: testssl said ${sev}`);
      if (f.sev === 'crit' || f.sev === 'high') assert.ok(sev === 'HIGH' || sev === 'CRITICAL', f.rule);
    }
    assert.ok(!c.findings.some((f) => ['OK', 'INFO', 'WARN'].includes(given.get(`${f.rule}|${f.port}`))));
  });

  test('the WARN row is undetermined with testssl\'s own text and no severity', () => {
    const warn = RAW.find((r) => r.severity === 'WARN');
    assert.deepEqual(c.undeterminedChecks, [{ rule: warn.id, host: '', port: warn.port, severity: 'WARN', message: warn.finding }]);
    assert.ok(!c.findings.some((f) => f.rule === warn.id));
  });
});

describe('severity mapping on drafted rows', () => {
  test('WARN and an unknown severity are undetermined; OK, INFO and DEBUG are not findings', () => {
    const c = _testsslCounts(write([
      { id: 'scanProblem', ...at, severity: 'WARN', finding: 'could not determine the protocol, skipping' },
      { id: 'BREACH', ...at, severity: 'WARN', finding: 'test failed (couldn\'t connect)' },
      { id: 'heartbleed', ...at, severity: 'severe', finding: 'vulnerable' },
      { id: 'TLS1_3', ...at, severity: 'OK', finding: 'offered' },
      { id: 'service', ...at, severity: 'INFO', finding: 'HTTP' },
      { id: 'debug', ...at, severity: 'DEBUG', finding: 'x' },
    ]), FILE);
    assert.deepEqual({ crit: c.crit, high: c.high, med: c.med, low: c.low, total: c.total, undetermined: c.undetermined },
      { crit: 0, high: 0, med: 0, low: 0, total: 0, undetermined: 3 });
    assert.deepEqual(c.undeterminedChecks.map((u) => [u.rule, u.severity, u.message]), [
      ['BREACH', 'WARN', 'test failed (couldn\'t connect)'],
      ['heartbleed', 'severe', 'vulnerable'],
      ['scanProblem', 'WARN', 'could not determine the protocol, skipping'],
    ]);
    assert.deepEqual(c.findings, []);
    assert.equal(c.unknown, undefined, 'a scan that ran is a result, its WARN rows are counted beside it');
  });

  test('graded rows keep testssl\'s grade, cve and cwe', () => {
    const c = _testsslCounts(write([
      { id: 'SSLv3', ...at, severity: 'HIGH', finding: 'offered (NOT ok)', cve: 'CVE-2014-3566', cwe: 'CWE-310' },
      { id: 'LOGJAM', ...at, severity: 'MEDIUM', finding: 'common prime' },
    ]), FILE);
    assert.deepEqual(c.findings.map((f) => [f.rule, f.host, f.port, f.sev, f.cve, f.cwe]), [
      ['LOGJAM', 'tls.example.invalid', '443', 'med', '', ''],
      ['SSLv3', 'tls.example.invalid', '443', 'high', 'CVE-2014-3566', 'CWE-310'],
    ]);
  });

  test('an address-only scan keys on the address', () => {
    const c = _testsslCounts(write([{ id: 'HSTS', ip: '/192.0.2.10', port: '8443', severity: 'LOW', finding: 'not offered' }]), FILE);
    assert.deepEqual([c.findings[0].host, c.findings[0].port], ['192.0.2.10', '8443']);
  });
});

describe('a scan that did not complete is a void, never zero findings', () => {
  test('absent is null', () => assert.equal(_testsslCounts(scratch(), FILE), null));

  test('unreadable, torn, wrong shape, empty, no rows and FATAL each carry a void flag and a reason', () => {
    const unreadable = scratch(); mkdirSync(join(unreadable, FILE));
    const cases = [
      [unreadable, 'unparseable'],
      [write('[{"id":"HSTS"'), 'unparseable'],
      [write({}), 'unparseable'],
      [write(''), 'toolfailed'],
      [write([]), 'toolfailed'],
      [write([{ id: 'cert_trust', ...at, severity: 'HIGH', finding: 'x' }, { id: 'scanProblem', ...at, severity: 'FATAL', finding: 'Can\'t connect to 192.0.2.10:443' }]), 'toolfailed'],
    ];
    for (const [d, flag] of cases) {
      const c = _testsslCounts(d, FILE);
      assert.equal(c[flag], true, `${flag}: ${JSON.stringify(c)}`);
      assert.ok(c.reason, 'the void says why');
      assert.equal(c.total, 0);
      assert.equal(c.findings, undefined, 'nothing graded beside a failed scan is published');
    }
    assert.match(_testsslCounts(cases[5][0], FILE).reason, /Can't connect/);
  });
});

describe('identity', () => {
  test('host, port and the testssl id, never a line', () => {
    assert.deepEqual(identityFor('tlsTestssl'), ['rule', 'host', 'port']);
    const row = { repo: 'r', rule: 'cert_trust', host: 'tls.example.invalid', port: '443', sev: 'high', message: 'x' };
    const key = (r) => scannerIdentityParts(r, 'tlsTestssl').parts.join('|');
    assert.equal(key({ ...row, sev: 'crit', message: 'y' }), key(row), 'a regrade is the same finding');
    assert.notEqual(key({ ...row, port: '8443' }), key(row), 'another port is another place');
    assert.notEqual(key({ ...row, host: 'other.example.invalid' }), key(row), 'another host is another place');
  });
});

describe('roster and kind', () => {
  test('a SCANNER_SPECS lane, no longer off-spec, and out of the headline as a duplicate', () => {
    assert.ok(SCANNER_SPECS.some(([k, check]) => k === 'tlsTestssl' && check === 'tls-testssl'));
    assert.ok(!OFF_SPEC_LANES.some(([k]) => k === 'tlsTestssl'));
    assert.equal(LANE_ROSTER.filter(([k]) => k === 'tlsTestssl').length, 1);
    assert.equal(kindOf('tlsTestssl'), 'posture');
    assert.ok(TOTALS_EXCLUDE.includes('tlsTestssl'));
  });

  test('the panel derives a Running services tab from the row schema', () => {
    const tab = derivedLaneTabs(SCANNER_SPECS.map(([k]) => k), []).find((t) => t.key === 'tlsTestssl');
    assert.equal(tab.section, 'dynamic');
    assert.deepEqual(panelSchema().tlsTestssl.identity, ['rule', 'host', 'port']);
  });
});

describe('rollup: the fixture reaches scanners and scannerFindings, not the headline', () => {
  const AT = '2026-10-08T01:00:00.000Z';
  const root = mkdtempSync(join(tmpdir(), 'cw-testssl-rollup-'));
  const reg = { reportsRoot: join(root, 'reports'), monitorOutput: 'area', defaultManifest: 'security-baseline',
    roots: [], projects: [], areas: [{ slug: 'area', label: 'area', out: 'area', primary: true, members: ['svc'] }] };
  writeFileSync(join(root, 'projects.json'), JSON.stringify(reg));
  mkdirSync(join(root, 'reports', 'area'), { recursive: true });
  const batch = join(root, 'reports', 'sweep-20261008010000-area');
  mkdirSync(join(batch, 'svc'), { recursive: true });
  writeFileSync(join(batch, 'batch-manifest.json'), JSON.stringify({
    sliceId: 'sweep-20261008010000', kind: 'sweep', group: 'all', only: null, sweptAll: false,
    area: 'area', areaOut: 'reports/area', startedAt: AT,
    scope: { repos: [{ name: 'svc', manifests: ['runtime'] }], excluded: [], lifecycle: {} }, anchors: {},
  }));
  writeFileSync(join(batch, 'svc', 'checks-status.json'), JSON.stringify([{ check: 'tls-testssl', status: 'pass', durationMs: 5, at: AT }]));
  copyFileSync(join(FIXTURE, FILE), join(batch, 'svc', FILE));
  const run = spawnSync(process.execPath, ['--import', 'data:text/javascript,globalThis.fetch = undefined;', join(CW, 'monitor', 'rollup.mjs'), batch], {
    cwd: CW, encoding: 'utf8', env: { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: join(root, 'projects.json'), CW_MONITOR_OUT: '' },
  });
  const rollup = () => JSON.parse(readFileSync(join(root, 'reports', 'area', 'rollup.json'), 'utf8'));

  test('the rollup ran', () => assert.equal(run.status, 0, run.stderr));

  test('scanners.tlsTestssl carries the fixture counts and undetermined', () => {
    const s = rollup().scanners.tlsTestssl;
    assert.deepEqual({ crit: s.crit, high: s.high, med: s.med, low: s.low, undetermined: s.undetermined, total: s.total, ran: s.ran },
      { crit: 1, high: 5, med: 1, low: 12, undetermined: 1, total: 19, ran: 1 });
    assert.equal(s.detail.rows, 19);
  });

  test('scannerFindings.tlsTestssl holds the 19 rows, each with its repo', () => {
    const r = rollup();
    assert.equal(r.scannerFindings.tlsTestssl.length, 19);
    assert.ok(r.scannerFindings.tlsTestssl.every((f) => f.repo === 'svc' && f.host === 'localhost' && f.port === '18443'));
    assert.deepEqual(r.conservation.violations, []);
    assert.ok(r.conservation.checked.includes('tlsTestssl'));
  });

  test('the repo block keeps the WARN text and the grade', () => {
    const b = rollup().repos.find((x) => x.name === 'svc').scanners.tlsTestssl;
    assert.equal(b.undeterminedChecks[0].rule, 'engine_problem');
    assert.equal(b.grades[0].grade, 'T');
  });

  test('the headline excludes it: no severity reaches totals or the posture partition', () => {
    const t = rollup().totals;
    assert.ok(t.excludedFromTotals.includes('tlsTestssl'));
    assert.deepEqual([t.crit, t.high, t.med, t.low, t.undetermined], [0, 0, 0, 0, 0]);
    assert.deepEqual(t.byKind.posture, { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 });
  });

  test('the scanner registry the panel reads names it', () => {
    assert.ok(rollup().scannerRegistry.some((e) => e.key === 'tlsTestssl' && e.check === 'tls-testssl' && /testssl/.test(e.label)));
  });
});
