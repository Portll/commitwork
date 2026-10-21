// Counts Trivy vulnerability severities from a JSON report (monitor/extractors/supply-chain.mjs _trivyCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _trivyCounts } from '../extractors/supply-chain.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_trivyCounts-'));
  try {
    const result = _trivyCounts(dir, 'missing.json');
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), '_trivyCounts-'));
  try {
    const f = join(dir, 'bad.json');
    writeFileSync(f, '{ invalid json');
    const result = _trivyCounts(dir, 'bad.json');
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts when Results is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), '_trivyCounts-'));
  try {
    const f = join(dir, 'empty.json');
    writeFileSync(f, JSON.stringify({ Results: [] }));
    const result = _trivyCounts(dir, 'empty.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts when Results is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), '_trivyCounts-'));
  try {
    const f = join(dir, 'noresults.json');
    writeFileSync(f, JSON.stringify({}));
    const result = _trivyCounts(dir, 'noresults.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts one critical vulnerability', () => {
  const dir = mkdtempSync(join(tmpdir(), '_trivyCounts-'));
  try {
    const f = join(dir, 'crit.json');
    const data = {
      Results: [{
        Vulnerabilities: [{
          VulnerabilityID: 'CVE-2023-0001',
          PkgName: 'log4j-core',
          InstalledVersion: '2.14.0',
          Severity: 'CRITICAL',
          FixedVersion: '2.17.1'
        }]
      }]
    };
    writeFileSync(f, JSON.stringify(data));
    const result = _trivyCounts(dir, 'crit.json');
    assert.equal(result.crit, 1);
    assert.equal(result.high, 0);
    assert.equal(result.med, 0);
    assert.equal(result.low, 0);
    assert.equal(result.total, 1);
    assert.equal(result.ran, true);
    assert.equal(result.findings.length, 1);
    assert.deepEqual(result.findings[0], {
      id: 'CVE-2023-0001',
      package: 'log4j-core',
      version: '2.14.0',
      sev: 'crit',
      fixed: '2.17.1'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts one high vulnerability', () => {
  const dir = mkdtempSync(join(tmpdir(), '_trivyCounts-'));
  try {
    const f = join(dir, 'high.json');
    const data = {
      Results: [{
        Vulnerabilities: [{
          VulnerabilityID: 'CVE-2023-0002',
          PkgName: 'spring-core',
          InstalledVersion: '5.3.0',
          Severity: 'HIGH',
          FixedVersion: '5.3.20'
        }]
      }]
    };
    writeFileSync(f, JSON.stringify(data));
    const result = _trivyCounts(dir, 'high.json');
    assert.equal(result.crit, 0);
    assert.equal(result.high, 1);
    assert.equal(result.med, 0);
    assert.equal(result.low, 0);
    assert.equal(result.total, 1);
    assert.equal(result.ran, true);
    assert.equal(result.findings.length, 1);
    assert.deepEqual(result.findings[0], {
      id: 'CVE-2023-0002',
      package: 'spring-core',
      version: '5.3.0',
      sev: 'high',
      fixed: '5.3.20'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts one medium vulnerability', () => {
  const dir = mkdtempSync(join(tmpdir(), '_trivyCounts-'));
  try {
    const f = join(dir, 'med.json');
    const data = {
      Results: [{
        Vulnerabilities: [{
          VulnerabilityID: 'CVE-2023-0003',
          PkgName: 'jackson-databind',
          InstalledVersion: '2.13.0',
          Severity: 'MEDIUM',
          FixedVersion: '2.13.4'
        }]
      }]
    };
    writeFileSync(f, JSON.stringify(data));
    const result = _trivyCounts(dir, 'med.json');
    assert.equal(result.crit, 0);
    assert.equal(result.high, 0);
    assert.equal(result.med, 1);
    assert.equal(result.low, 0);
    assert.equal(result.total, 1);
    assert.equal(result.ran, true);
    assert.equal(result.findings.length, 1);
    assert.deepEqual(result.findings[0], {
      id: 'CVE-2023-0003',
      package: 'jackson-databind',
      version: '2.13.0',
      sev: 'med',
      fixed: '2.13.4'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts one low vulnerability', () => {
  const dir = mkdtempSync(join(tmpdir(), '_trivyCounts-'));
  try {
    const f = join(dir, 'low.json');
    const data = {
      Results: [{
        Vulnerabilities: [{
          VulnerabilityID: 'CVE-2023-0004',
          PkgName: 'commons-lang3',
          InstalledVersion: '3.12.0',
          Severity: 'LOW',
          FixedVersion: '3.12.1'
        }]
      }]
    };
    writeFileSync(f, JSON.stringify(data));
    const result = _trivyCounts(dir, 'low.json');
    assert.equal(result.crit, 0);
    assert.equal(result.high, 0);
    assert.equal(result.med, 0);
    assert.equal(result.low, 1);
    assert.equal(result.total, 1);
    assert.equal(result.ran, true);
    assert.equal(result.findings.length, 1);
    assert.deepEqual(result.findings[0], {
      id: 'CVE-2023-0004',
      package: 'commons-lang3',
      version: '3.12.0',
      sev: 'low',
      fixed: '3.12.1'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips vulnerabilities with unknown severity', () => {
  const dir = mkdtempSync(join(tmpdir(), '_trivyCounts-'));
  try {
    const f = join(dir, 'unknown.json');
    const data = {
      Results: [{
        Vulnerabilities: [
          {
            VulnerabilityID: 'CVE-2023-0005',
            PkgName: 'unknown-pkg',
            InstalledVersion: '1.0.0',
            Severity: 'UNKNOWN',
            FixedVersion: '1.0.1'
          }
        ]
      }]
    };
    writeFileSync(f, JSON.stringify(data));
    const result = _trivyCounts(dir, 'unknown.json');
    assert.equal(result.crit, 0);
    assert.equal(result.high, 0);
    assert.equal(result.med, 0);
    assert.equal(result.low, 0);
    assert.equal(result.total, 0);
    assert.equal(result.ran, true);
    assert.equal(result.findings.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips vulnerabilities with missing severity', () => {
  const dir = mkdtempSync(join(tmpdir(), '_trivyCounts-'));
  try {
    const f = join(dir, 'nosev.json');
    const data = {
      Results: [{
        Vulnerabilities: [
          {
            VulnerabilityID: 'CVE-2023-0006',
            PkgName: 'nosev-pkg',
            InstalledVersion: '2.0.0',
            FixedVersion: '2.0.1'
          }
        ]
      }]
    };
    writeFileSync(f, JSON.stringify(data));
    const result = _trivyCounts(dir, 'nosev.json');
    assert.equal(result.crit, 0);
    assert.equal(result.high, 0);
    assert.equal(result.med, 0);
    assert.equal(result.low, 0);
    assert.equal(result.total, 0);
    assert.equal(result.ran, true);
    assert.equal(result.findings.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts multiple vulnerabilities across severities', () => {
  const dir = mkdtempSync(join(tmpdir(), '_trivyCounts-'));
  try {
    const f = join(dir, 'multi.json');
    const data = {
      Results: [
        {
          Vulnerabilities: [
            {
              VulnerabilityID: 'CVE-2023-0010',
              PkgName: 'pkg-a',
              InstalledVersion: '1.0.0',
              Severity: 'CRITICAL',
              FixedVersion: '1.0.1'
            },
            {
              VulnerabilityID: 'CVE-2023-0011',
              PkgName: 'pkg-b',
              InstalledVersion: '2.0.0',
              Severity: 'HIGH',
              FixedVersion: '2.0.1'
            }
          ]
        },
        {
          Vulnerabilities: [
            {
              VulnerabilityID: 'CVE-2023-0012',
              PkgName: 'pkg-c',
              InstalledVersion: '3.0.0',
              Severity: 'MEDIUM',
              FixedVersion: '3.0.1'
            },
            {
              VulnerabilityID: 'CVE-2023-0013',
              PkgName: 'pkg-d',
              InstalledVersion: '4.0.0',
              Severity: 'LOW',
              FixedVersion: '4.0.1'
            },
            {
              VulnerabilityID: 'CVE-2023-0014',
              PkgName: 'pkg-e',
              InstalledVersion: '5.0.0',
              Severity: 'UNKNOWN',
              FixedVersion: '5.0.1'
            }
          ]
        }
      ]
    };
    writeFileSync(f, JSON.stringify(data));
    const result = _trivyCounts(dir, 'multi.json');
    assert.equal(result.crit, 1);
    assert.equal(result.high, 1);
    assert.equal(result.med, 1);
    assert.equal(result.low, 1);
    assert.equal(result.total, 4);
    assert.equal(result.ran, true);
    assert.equal(result.findings.length, 4);
    assert.deepEqual(result.findings[0], { id: 'CVE-2023-0010', package: 'pkg-a', version: '1.0.0', sev: 'crit', fixed: '1.0.1' });
    assert.deepEqual(result.findings[1], { id: 'CVE-2023-0011', package: 'pkg-b', version: '2.0.0', sev: 'high', fixed: '2.0.1' });
    assert.deepEqual(result.findings[2], { id: 'CVE-2023-0012', package: 'pkg-c', version: '3.0.0', sev: 'med', fixed: '3.0.1' });
    assert.deepEqual(result.findings[3], { id: 'CVE-2023-0013', package: 'pkg-d', version: '4.0.0', sev: 'low', fixed: '4.0.1' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
