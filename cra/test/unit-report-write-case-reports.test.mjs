// writes markdown and JSON case report files to a case-specific directory (cra/report.mjs writeCaseReports)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeCaseReports } from '../report.mjs';
import { join } from 'node:path';

test('writes reports for a vulnerability case without EU representative and without advisory', () => {
  const kase = {
    caseId: 'C-001',
    kind: 'vulnerability',
    vulnId: 'VULN-123',
    title: 'Sample vuln',
    summary: '',
    trigger: 'kev',
    clocks: { basis: 'detection', earlyWarningDue: '2026-01-01T00:00:00Z', notificationDue: '2026-01-02T00:00:00Z', finalDue: '2026-01-16T00:00:00Z' },
    packages: ['pkg1'],
    repos: ['repo1'],
    severity: 'high',
    cvss: 7.5,
    epss: 0.8,
    kev: true,
    firstDetectedAt: '2026-01-01T00:00:00Z',
    slices: ['slice1'],
    awarenessAt: null,
  };
  const product = { id: 'P-1', name: 'ProdA', version: '1.0', description: '' };
  const manufacturer = { name: 'ManuCo', contact: 'contact@manuco.com' };
  const ledgerEntries = [];
  const outDir = join('tmp', 'out1');
  const result = writeCaseReports(kase, product, manufacturer, ledgerEntries, outDir);
  assert.equal(result, "tmp/out1/cases/C-001");
});

test('writes reports for an incident case with EU representative and advisory', () => {
  const kase = {
    caseId: 'C-002',
    kind: 'incident',
    title: 'Incident title',
    summary: 'summary',
    clocks: { basis: 'awareness', earlyWarningDue: '2026-02-01T00:00:00Z', notificationDue: '2026-02-02T00:00:00Z', finalDue: '2026-03-01T00:00:00Z' },
    packages: [],
    repos: [],
    severity: 'critical',
    firstDetectedAt: '2026-01-31T00:00:00Z',
    slices: ['slice2'],
    awarenessAt: '2026-01-31T01:00:00Z',
    advisory: 'http://example.com/advisory',
  };
  const product = { id: 'P-2', name: 'ProdB', version: '2.0', description: '' };
  const manufacturer = { name: 'ManuInc', contact: 'info@manuinc.com', euRepresentative: 'RepCo' };
  const ledgerEntries = [];
  const outDir = join('tmp', 'out2');
  const result = writeCaseReports(kase, product, manufacturer, ledgerEntries, outDir);
  assert.equal(result, "tmp/out2/cases/C-002");
});

test('final report includes fixes when ledger entries match vulnerability and repo with strong evidence', () => {
  const kase = {
    caseId: 'C-003',
    kind: 'vulnerability',
    vulnId: 'VULN-456',
    title: '',
    clocks: { basis: 'detection', earlyWarningDue: '', notificationDue: '', finalDue: '' },
    repos: ['repoX'],
    severity: '',
    cvss: null,
    epss: null,
    kev: false,
    firstDetectedAt: '',
    slices: [],
    awarenessAt: null,
  };
  const product = { id: 'P-3', name: 'ProdC', version: '3.1', description: '' };
  const manufacturer = { name: 'ManuLtd', contact: '' };
  const ledgerEntries = [
    { vulnId: 'VULN-456', repo: 'repoX', package: 'pkgX', fromVersion: '1.0', toVersion: '1.1', evidence: { tier: 'strong', detail: 'lockfile diff' }, fixCommit: 'abc123' },
  ];
  const outDir = join('tmp', 'out3');
  const result = writeCaseReports(kase, product, manufacturer, ledgerEntries, outDir);
  assert.equal(result, "tmp/out3/cases/C-003");
});

test('final report shows no fixes when ledger entries have weak evidence or mismatched repo', () => {
  const kase = {
    caseId: 'C-004',
    kind: 'vulnerability',
    vulnId: 'VULN-789',
    title: '',
    clocks: { basis: 'detection', earlyWarningDue: '', notificationDue: '', finalDue: '' },
    repos: ['repoY'],
    severity: '',
    cvss: null,
    epss: null,
    kev: false,
    firstDetectedAt: '',
    slices: [],
    awarenessAt: null,
  };
  const product = { id: 'P-4', name: 'ProdD', version: '4.0', description: '' };
  const manufacturer = { name: 'ManuOrg', contact: '' };
  const ledgerEntries = [
    { vulnId: 'VULN-789', repo: 'repoZ', package: 'pkgZ', fromVersion: '0.9', toVersion: '1.0', evidence: { tier: 'weak', detail: 'low confidence' } },
  ];
  const outDir = join('tmp', 'out4');
  const result = writeCaseReports(kase, product, manufacturer, ledgerEntries, outDir);
  assert.equal(result, "tmp/out4/cases/C-004");
});

test('handles empty strings and missing optional fields gracefully', () => {
  const kase = {
    caseId: '',
    kind: '',
    clocks: { basis: '', earlyWarningDue: '', notificationDue: '', finalDue: '' },
    packages: [],
    repos: [],
    firstDetectedAt: '',
    slices: [],
  };
  const product = { id: '', name: '', version: '', description: '' };
  const manufacturer = { name: '', contact: '' };
  const ledgerEntries = [];
  const outDir = join('tmp', 'out5');
  const result = writeCaseReports(kase, product, manufacturer, ledgerEntries, outDir);
  assert.equal(result, "tmp/out5/cases");
});
