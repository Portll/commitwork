// cra/test/report-units.test.mjs — case tests for renderEarlyWarning, renderNotification, renderFinal, writeCaseReports.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderEarlyWarning, renderNotification, renderFinal, writeCaseReports } from '../report.mjs';

describe('renderEarlyWarning', () => {
  const ref = '2026-09-11T00:00:00.000Z';

  const kase = {
    caseId: 'C1',
    kind: 'vulnerability',
    vulnId: 'CVE-2026-0001',
    title: 'RCE in parser',
    summary: 'Remote code execution',
    trigger: 'kev',
    severity: 'critical',
    cvss: 9.8,
    epss: 0.9,
    kev: true,
    advisory: 'ADV-1',
    packages: ['pkg-a'],
    repos: ['repo-a'],
    firstDetectedAt: '2026-09-10T00:00:00.000Z',
    awarenessAt: '2026-09-10T01:00:00.000Z',
    slices: ['s1'],
    clocks: {
      basis: 'awareness',
      earlyWarningDue: '2026-09-11T01:00:00.000Z',
      notificationDue: '2026-09-13T01:00:00.000Z',
      finalDue: '2026-09-24T01:00:00.000Z',
      finalBasis: 'awareness + 14 days',
    },
  };

  const product = { id: 'p1', name: 'Widget', version: '1.0.0' };
  const manufacturer = { name: 'Acme', contact: 'csirt@acme.example' };

  test('returns object with md and json', () => {
    const r = renderEarlyWarning(kase, product, manufacturer, ref);
    assert.equal(typeof r.md, 'string');
    assert.equal(typeof r.json, 'object');
  });

  test('json has expected fields', () => {
    const { json } = renderEarlyWarning(kase, product, manufacturer, ref);
    assert.equal(json.type, 'early-warning');
    assert.equal(json.case, 'C1');
    assert.equal(json.vulnId, 'CVE-2026-0001');
    assert.equal(json.draft, true);
    assert.equal(json.generatedAt, ref);
  });

  test('md contains draft banner and subject', () => {
    const { md } = renderEarlyWarning(kase, product, manufacturer, ref);
    assert.ok(md.includes('DRAFT — NOT SUBMITTED'));
    assert.ok(md.includes('CVE-2026-0001'));
    assert.ok(md.includes('Widget'));
  });

  test('md contains notification type for vulnerability', () => {
    const { md } = renderEarlyWarning(kase, product, manufacturer, ref);
    assert.ok(md.includes('actively exploited vulnerability'));
  });

  test('md contains awareness and first detected', () => {
    const { md } = renderEarlyWarning(kase, product, manufacturer, ref);
    assert.ok(md.includes('2026-09-10T00:00:00.000Z'));
    assert.ok(md.includes('2026-09-10T01:00:00.000Z'));
  });

  test('md contains clocks with overdue marker when ref is after due', () => {
    const lateRef = '2026-09-12T00:00:00.000Z';
    const { md } = renderEarlyWarning(kase, product, manufacturer, lateRef);
    assert.ok(md.includes('⚠️ OVERDUE'));
  });

  test('md does not contain overdue marker when ref is before due', () => {
    const earlyRef = '2026-09-10T12:00:00.000Z';
    const { md } = renderEarlyWarning(kase, product, manufacturer, earlyRef);
    assert.ok(!md.includes('⚠️ OVERDUE'));
  });

  test('incident kind renders incident subject and trigger', () => {
    const incKase = { ...kase, kind: 'incident', vulnId: undefined, title: 'Outage' };
    const { md, json } = renderEarlyWarning(incKase, product, manufacturer, ref);
    assert.ok(md.includes('incident "Outage"'));
    assert.ok(md.includes('severe incident'));
    assert.equal(json.vulnId, undefined);
  });
});

describe('renderNotification', () => {
  const ref = '2026-01-01T00:00:00.000Z';
  const kase = {
    caseId: 'C1', kind: 'vulnerability', vulnId: 'CVE-1', title: 'T',
    severity: 'high', cvss: 9.8, epss: 0.5, kev: true, trigger: 'kev',
    packages: ['p1'], repos: ['r1'], measures: [{ detail: 'patched', at: '2025-12-31T00:00:00.000Z' }],
    clocks: { basis: 'b', earlyWarningDue: '2025-12-31T00:00:00.000Z', notificationDue: '2026-01-01T00:00:00.000Z', finalDue: '2026-01-15T00:00:00.000Z', finalBasis: 'fb' }
  };
  const product = { id: 'P1', name: 'Prod', version: '1.0', description: 'desc' };
  const manufacturer = { name: 'M', contact: 'c' };

  test('returns object with md and json', () => {
    const r = renderNotification(kase, product, manufacturer, ref);
    assert.equal(typeof r.md, 'string');
    assert.equal(typeof r.json, 'object');
  });

  test('md contains title and draft banner', () => {
    const r = renderNotification(kase, product, manufacturer, ref);
    assert.ok(r.md.includes('Vulnerability notification (72h)'));
    assert.ok(r.md.includes('DRAFT — NOT SUBMITTED'));
  });

  test('json type and draft flag', () => {
    const r = renderNotification(kase, product, manufacturer, ref);
    assert.equal(r.json.type, 'vulnerability-notification');
    assert.equal(r.json.draft, true);
  });

  test('json fields from kase', () => {
    const r = renderNotification(kase, product, manufacturer, ref);
    assert.equal(r.json.case, 'C1');
    assert.equal(r.json.vulnId, 'CVE-1');
    assert.equal(r.json.severity, 'high');
    assert.equal(r.json.cvss, 9.8);
    assert.equal(r.json.epss, 0.5);
    assert.equal(r.json.kev, true);
    assert.equal(r.json.generatedAt, ref);
  });

  test('measures rendered in md', () => {
    const r = renderNotification(kase, product, manufacturer, ref);
    assert.ok(r.md.includes('patched (2025-12-31T00:00:00.000Z)'));
  });

  test('no measures shows TODO', () => {
    const k2 = { ...kase, measures: [] };
    const r = renderNotification(k2, product, manufacturer, ref);
    assert.ok(r.md.includes('TODO — none recorded yet'));
  });

  test('incident kind changes title', () => {
    const k2 = { ...kase, kind: 'incident', title: 'Big' };
    const r = renderNotification(k2, product, manufacturer, ref);
    assert.ok(r.md.includes('Incident notification (72h)'));
  });

  test('overdue clock marker', () => {
    const k2 = { ...kase, clocks: { ...kase.clocks, notificationDue: '2025-12-30T00:00:00.000Z' } };
    const r = renderNotification(k2, product, manufacturer, ref);
    assert.ok(r.md.includes('⚠️ OVERDUE'));
  });
});

describe('renderFinal', () => {
  const ref = '2026-01-01T00:00:00.000Z';
  const kase = {
    caseId: 'c1', kind: 'vulnerability', vulnId: 'CVE-1', title: 'T',
    severity: 'high', cvss: 9.8, epss: 0.5, kev: true, trigger: 'kev',
    packages: ['p'], repos: ['r1'],
    clocks: { basis: 'b', earlyWarningDue: ref, notificationDue: ref, finalDue: ref, finalBasis: 'fb' },
  };
  const product = { id: 'p1', name: 'P', version: '1.0' };
  const manufacturer = { name: 'M', contact: 'c' };

  test('returns md and json', () => {
    const r = renderFinal(kase, product, manufacturer, [], ref);
    assert.equal(typeof r.md, 'string');
    assert.equal(typeof r.json, 'object');
  });

  test('json type and draft', () => {
    const r = renderFinal(kase, product, manufacturer, [], ref);
    assert.equal(r.json.type, 'final-report');
    assert.equal(r.json.draft, true);
  });

  test('json case and vulnId', () => {
    const r = renderFinal(kase, product, manufacturer, [], ref);
    assert.equal(r.json.case, 'c1');
    assert.equal(r.json.vulnId, 'CVE-1');
  });

  test('json generatedAt is ref', () => {
    const r = renderFinal(kase, product, manufacturer, [], ref);
    assert.equal(r.json.generatedAt, ref);
  });

  test('no fixes when ledger empty', () => {
    const r = renderFinal(kase, product, manufacturer, [], ref);
    assert.deepEqual(r.json.verifiedFixes, []);
    assert.match(r.md, /no verified fix in the remediation ledger yet/);
  });

  test('includes matching strong fix', () => {
    const ledger = [{ vulnId: 'CVE-1', repo: 'r1', package: 'pkg', fromVersion: '1', toVersion: '2', evidence: { tier: 'strong', detail: 'd' } }];
    const r = renderFinal(kase, product, manufacturer, ledger, ref);
    assert.equal(r.json.verifiedFixes.length, 1);
    assert.match(r.json.verifiedFixes[0], /r1: pkg 1 → 2/);
  });

  test('excludes weak tier', () => {
    const ledger = [{ vulnId: 'CVE-1', repo: 'r1', package: 'pkg', fromVersion: '1', toVersion: '2', evidence: { tier: 'weak', detail: 'd' } }];
    const r = renderFinal(kase, product, manufacturer, ledger, ref);
    assert.deepEqual(r.json.verifiedFixes, []);
  });

  test('excludes non-matching repo', () => {
    const ledger = [{ vulnId: 'CVE-1', repo: 'other', package: 'pkg', fromVersion: '1', toVersion: '2', evidence: { tier: 'strong', detail: 'd' } }];
    const r = renderFinal(kase, product, manufacturer, ledger, ref);
    assert.deepEqual(r.json.verifiedFixes, []);
  });
});

describe('writeCaseReports', () => {
  const ref = '2026-09-11T00:00:00.000Z';
  const kase = {
    caseId: 'c1', kind: 'vulnerability', vulnId: 'CVE-1', title: 'T',
    packages: ['p'], repos: ['r'], severity: 'high', cvss: 9.0, epss: 0.5, kev: true,
    trigger: 'kev', advisory: 'adv', firstDetectedAt: '2026-09-10T00:00:00.000Z',
    awarenessAt: '2026-09-10T01:00:00.000Z',
    clocks: { basis: 'b', earlyWarningDue: '2026-09-11T01:00:00.000Z', notificationDue: '2026-09-13T01:00:00.000Z', finalDue: '2026-09-24T01:00:00.000Z', finalBasis: 'fb' },
    measures: [{ detail: 'd', at: '2026-09-11T02:00:00.000Z' }],
    slices: ['s1'],
  };
  const product = { id: 'p1', name: 'P', version: '1.0', description: 'desc', repos: ['r'] };
  const manufacturer = { name: 'M', contact: 'c', euRepresentative: 'er' };
  const ledger = [{ vulnId: 'CVE-1', repo: 'r', package: 'p', fromVersion: '0.9', toVersion: '1.1', evidence: { tier: 'strong', detail: 'dd' }, fixCommit: 'abc' }];

  test('returns the cases/<id> directory path', () => {
    const out = mkdtempSync(join(tmpdir(), 'cra-'));
    try {
      const dir = writeCaseReports(kase, product, manufacturer, ledger, out, ref);
      assert.equal(dir, join(out, 'cases', 'c1'));
    } finally { rmSync(out, { recursive: true, force: true }); }
  });

  test('writes all six files', () => {
    const out = mkdtempSync(join(tmpdir(), 'cra-'));
    try {
      const dir = writeCaseReports(kase, product, manufacturer, ledger, out, ref);
      for (const f of ['early-warning.md', 'early-warning.json', 'notification.md', 'notification.json', 'final-report.md', 'final-report.json']) {
        assert.ok(existsSync(join(dir, f)), f);
      }
    } finally { rmSync(out, { recursive: true, force: true }); }
  });

  test('early-warning.json has type and draft true', () => {
    const out = mkdtempSync(join(tmpdir(), 'cra-'));
    try {
      const dir = writeCaseReports(kase, product, manufacturer, ledger, out, ref);
      const j = JSON.parse(readFileSync(join(dir, 'early-warning.json'), 'utf8'));
      assert.equal(j.type, 'early-warning');
      assert.equal(j.draft, true);
      assert.equal(j.case, 'c1');
    } finally { rmSync(out, { recursive: true, force: true }); }
  });

  test('notification.json has type vulnerability-notification', () => {
    const out = mkdtempSync(join(tmpdir(), 'cra-'));
    try {
      const dir = writeCaseReports(kase, product, manufacturer, ledger, out, ref);
      const j = JSON.parse(readFileSync(join(dir, 'notification.json'), 'utf8'));
      assert.equal(j.type, 'vulnerability-notification');
      assert.equal(j.severity, 'high');
      assert.equal(j.cvss, 9.0);
    } finally { rmSync(out, { recursive: true, force: true }); }
  });

  test('final-report.json has type final-report and verifiedFixes', () => {
    const out = mkdtempSync(join(tmpdir(), 'cra-'));
    try {
      const dir = writeCaseReports(kase, product, manufacturer, ledger, out, ref);
      const j = JSON.parse(readFileSync(join(dir, 'final-report.json'), 'utf8'));
      assert.equal(j.type, 'final-report');
      assert.equal(j.verifiedFixes.length, 1);
      assert.match(j.verifiedFixes[0], /r: p 0\.9 → 1\.1/);
    } finally { rmSync(out, { recursive: true, force: true }); }
  });

  test('early-warning.md contains the draft banner', () => {
    const out = mkdtempSync(join(tmpdir(), 'cra-'));
    try {
      const dir = writeCaseReports(kase, product, manufacturer, ledger, out, ref);
      const md = readFileSync(join(dir, 'early-warning.md'), 'utf8');
      assert.match(md, /DRAFT — NOT SUBMITTED/);
      assert.match(md, /Early warning \(24h\)/);
    } finally { rmSync(out, { recursive: true, force: true }); }
  });

  test('final-report.md shows verified remediation when ledger has strong entry', () => {
    const out = mkdtempSync(join(tmpdir(), 'cra-'));
    try {
      const dir = writeCaseReports(kase, product, manufacturer, ledger, out, ref);
      const md = readFileSync(join(dir, 'final-report.md'), 'utf8');
      assert.match(md, /backed by the commitwork remediation ledger/);
    } finally { rmSync(out, { recursive: true, force: true }); }
  });

  test('final-report.md shows no-remediation message when ledger empty', () => {
    const out = mkdtempSync(join(tmpdir(), 'cra-'));
    try {
      const dir = writeCaseReports(kase, product, manufacturer, [], out, ref);
      const md = readFileSync(join(dir, 'final-report.md'), 'utf8');
      assert.match(md, /No strong\/medium-tier ledger entry yet/);
    } finally { rmSync(out, { recursive: true, force: true }); }
  });
});
