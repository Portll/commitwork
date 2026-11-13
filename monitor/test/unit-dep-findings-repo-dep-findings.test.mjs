// repoDepFindings aggregates OSV and npm audit findings, dedupes and marks corroboration (monitor/dep-findings.mjs repoDepFindings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoDepFindings } from '../dep-findings.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'repoDepFindings-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const minimalSarif = JSON.stringify({ runs: [] });

const sarifWithResult = JSON.stringify({
  runs: [{
    results: [{
      ruleId: 'CVE-2023-0001',
      message: { text: "Package 'testpkg@1.0.0' is vulnerable" },
      locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///path/to/manifest' } } }]
    }],
    tool: { driver: { rules: [{ id: 'CVE-2023-0001', properties: { 'security-severity': '7.5' }, shortDescription: { text: 'CVE-2023-0001' } }] } }
  }]
});

const declaredVerdict = JSON.stringify({
  ran: true,
  manifests: {
    'file:///path/to/manifest': { readable: true, resolved: ['testpkg@1.0.0'] }
  }
});

const declaredVerdictMissing = JSON.stringify({
  ran: true,
  manifests: {
    'file:///path/to/manifest': { readable: true, resolved: [] }
  }
});

const npmAuditSimple = JSON.stringify({
  vulnerabilities: {
    lodash: {
      severity: 'high',
      range: '<4.17.21',
      fixAvailable: { name: 'lodash', version: '4.17.21' }
    }
  }
});

const npmAuditVia = JSON.stringify({
  vulnerabilities: {
    express: {
      severity: 'moderate',
      via: [
        { source: 'npm', name: 'express', severity: 'moderate', cvss: { score: 5.0 }, url: 'https://github.com/advisories/GHSA-xxxx', title: 'Express issue', range: '<4.17.0' },
        'npm'
      ],
      range: '<4.17.0',
      fixAvailable: true
    }
  }
});

test('returns empty findings and ok state when OSV SARIF has no runs and npm audit is absent', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, 'osv.sarif'), minimalSarif);
    const result = repoDepFindings(dir);
    assert.deepEqual(result, { findings: [], state: { osv: "never-ran", npm: "absent" } });
  });
});

test('processes a single OSV result with declared verdict marking it as declared', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, 'osv.sarif'), sarifWithResult);
    writeFileSync(join(dir, 'osv-declared.json'), declaredVerdict);
    const result = repoDepFindings(dir);
    assert.deepEqual(result, { findings: [{ tool: "osv", id: "CVE-2023-0001", cvss: 7.5, severity: "unknown", malicious: false, undetermined: true, unknown: true, resolutionBasis: "resolved", undeterminedCode: "version-not-declared", claimedSeverity: "high", undeterminedReason: "the manifest path/to/manifest does not state testpkg@1.0.0; osv-scanner resolved it from an unpinned requirement, so this describes the lowest tree the declared floors permit rather than what this repository installs", package: "testpkg", version: "1.0.0", path: "file:///path/to/manifest", aliases: [], fixed: "", title: "CVE-2023-0001", advisory: "https://osv.dev/vulnerability/CVE-2023-0001" }], state: { osv: "ok", npm: "absent" } });
  });
});

test('processes a single OSV result with declared verdict marking it as not declared (unknown severity)', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, 'osv.sarif'), sarifWithResult);
    writeFileSync(join(dir, 'osv-declared.json'), declaredVerdictMissing);
    const result = repoDepFindings(dir);
    assert.deepEqual(result, { findings: [{ tool: "osv", id: "CVE-2023-0001", cvss: 7.5, severity: "high", malicious: false, package: "testpkg", version: "1.0.0", path: "file:///path/to/manifest", aliases: [], fixed: "", title: "CVE-2023-0001", advisory: "https://osv.dev/vulnerability/CVE-2023-0001" }], state: { osv: "ok", npm: "absent" } });
  });
});

test('handles npm audit JSON with a simple vulnerability and no OSV data', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, 'npm-audit.json'), npmAuditSimple);
    writeFileSync(join(dir, 'osv.sarif'), minimalSarif);
    const result = repoDepFindings(dir);
    assert.deepEqual(result, { findings: [{ tool: "npm", id: "lodash", cvss: 0, severity: "high", package: "lodash", version: "", path: "package-lock.json", range: "<4.17.21", fixed: "lodash@4.17.21", title: "lodash (high)", advisory: "", citesNoAdvisory: true, attribution: "parent-rollup" }], state: { osv: "never-ran", npm: "ok" } });
  });
});

test('handles npm audit JSON with via objects and merges with OSV findings', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, 'npm-audit.json'), npmAuditVia);
    writeFileSync(join(dir, 'osv.sarif'), sarifWithResult);
    const result = repoDepFindings(dir);
    assert.deepEqual(result, { findings: [{ tool: "osv", id: "CVE-2023-0001", cvss: 7.5, severity: "high", malicious: false, package: "testpkg", version: "1.0.0", path: "file:///path/to/manifest", aliases: [], fixed: "", title: "CVE-2023-0001", advisory: "https://osv.dev/vulnerability/CVE-2023-0001" }, { tool: "npm", id: "GHSA-xxxx", cvss: 5, severity: "med", package: "express", version: "", path: "package-lock.json", range: "<4.17.0", fixed: "4.17.0", title: "Express issue", advisory: "https://github.com/advisories/GHSA-xxxx" }], state: { osv: "ok", npm: "ok" } });
  });
});

test('a scoped OSV package reaches the row with its scope and last-@ version', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, 'osv.sarif'), JSON.stringify({
      runs: [{
        results: [{
          ruleId: 'CVE-2023-0002',
          message: { text: "Package '@babel/core@7.24.0' is vulnerable" },
          locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///path/package-lock.json' } } }],
        }],
        tool: { driver: { rules: [{ id: 'CVE-2023-0002', properties: { 'security-severity': '7.5' }, shortDescription: { text: 'CVE-2023-0002' } }] } },
      }],
    }));
    const { findings } = repoDepFindings(dir);
    assert.equal(findings[0].package, '@babel/core');
    assert.equal(findings[0].version, '7.24.0');
  });
});

test('throws when OSV SARIF file is malformed JSON', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, 'osv.sarif'), '{ not: json ');
    assert.deepStrictEqual(repoDepFindings(dir), { findings: [], state: { osv: "unparseable", npm: "absent" } });
  });
});
