// Parses npm-audit.json into rows with severity, fix targets, and advisory URLs (monitor/dep-findings.mjs parseNpm).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNpm } from '../dep-findings.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns absent state when npm-audit.json is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseNpm-'));
  try {
    const r = parseNpm(dir);
    assert.deepEqual(r, { rows: [], state: 'absent' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable state when npm-audit.json is invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseNpm-'));
  try {
    writeFileSync(join(dir, 'npm-audit.json'), 'not valid json');
    const r = parseNpm(dir);
    assert.deepEqual(r, { rows: [], state: 'unparseable' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok state with empty rows when vulnerabilities is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseNpm-'));
  try {
    writeFileSync(join(dir, 'npm-audit.json'), JSON.stringify({ vulnerabilities: {} }));
    const r = parseNpm(dir);
    assert.deepEqual(r, { rows: [], state: 'ok' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok state with empty rows when vulnerabilities is undefined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseNpm-'));
  try {
    writeFileSync(join(dir, 'npm-audit.json'), JSON.stringify({}));
    const r = parseNpm(dir);
    assert.deepEqual(r, { rows: [], state: 'ok' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps a vulnerability with no via entries to a single row with package name as id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseNpm-'));
  try {
    const data = {
      vulnerabilities: {
        'lodash': {
          severity: 'high',
          via: [],
          range: '<4.17.21',
          fixAvailable: { name: 'lodash', version: '4.17.21' }
        }
      }
    };
    writeFileSync(join(dir, 'npm-audit.json'), JSON.stringify(data));
    const r = parseNpm(dir);
    assert.equal(r.state, 'ok');
    assert.equal(r.rows.length, 1);
    const row = r.rows[0];
    assert.equal(row.tool, 'npm');
    assert.equal(row.id, 'lodash');
    assert.equal(row.cvss, 0);
    assert.equal(row.severity, 'high');
    assert.equal(row.package, 'lodash');
    assert.equal(row.version, '');
    assert.equal(row.path, 'package-lock.json');
    assert.equal(row.range, '<4.17.21');
    assert.equal(row.fixed, 'lodash@4.17.21');
    assert.equal(row.title, 'lodash (high)');
    assert.equal(row.advisory, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps a vulnerability with via entries to one row per advisory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseNpm-'));
  try {
    const data = {
      vulnerabilities: {
        'left-pad': {
          severity: 'critical',
          via: [
            {
              source: 'npm:GHSA-1184-j2r4-8856',
              url: 'https://github.com/advisories/GHSA-1184-j2r4-8856',
              name: 'left-pad',
              title: 'left-pad vulnerability',
              severity: 'critical',
              cvss: { score: 9.8 },
              range: '<1.3.0'
            },
            {
              source: 'npm:CVE-2021-44228',
              url: 'https://nvd.nist.gov/vuln/detail/CVE-2021-44228',
              name: 'left-pad',
              title: 'Log4Shell',
              severity: 'high',
              cvss: { score: 7.5 },
              range: '<1.3.0'
            }
          ],
          range: '<1.3.0',
          fixAvailable: { name: 'left-pad', version: '1.3.0' }
        }
      }
    };
    writeFileSync(join(dir, 'npm-audit.json'), JSON.stringify(data));
    const r = parseNpm(dir);
    assert.equal(r.state, 'ok');
    assert.equal(r.rows.length, 2);

    const row0 = r.rows[0];
    assert.equal(row0.tool, 'npm');
    assert.equal(row0.id, 'GHSA-1184-j2r4-8856');
    assert.equal(row0.cvss, 9.8);
    assert.equal(row0.severity, 'crit');
    assert.equal(row0.package, 'left-pad');
    assert.equal(row0.version, '');
    assert.equal(row0.path, 'package-lock.json');
    assert.equal(row0.range, '<1.3.0');
    assert.equal(row0.fixed, 'left-pad@1.3.0');
    assert.equal(row0.title, 'left-pad vulnerability');
    assert.equal(row0.advisory, 'https://github.com/advisories/GHSA-1184-j2r4-8856');

    const row1 = r.rows[1];
    assert.equal(row1.tool, 'npm');
    assert.equal(row1.id, 'CVE-2021-44228');
    assert.equal(row1.cvss, 7.5);
    assert.equal(row1.severity, 'high');
    assert.equal(row1.package, 'left-pad');
    assert.equal(row1.version, '');
    assert.equal(row1.path, 'package-lock.json');
    assert.equal(row1.range, '<1.3.0');
    assert.equal(row1.fixed, 'left-pad@1.3.0');
    assert.equal(row1.title, 'Log4Shell');
    assert.equal(row1.advisory, 'https://nvd.nist.gov/vuln/detail/CVE-2021-44228');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses parent severity when advisory severity is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseNpm-'));
  try {
    const data = {
      vulnerabilities: {
        'pkg': {
          severity: 'moderate',
          via: [
            {
              source: 'npm:GHSA-abc',
              url: 'https://github.com/advisories/GHSA-abc',
              name: 'pkg',
              title: 'Some issue',
              cvss: { score: 5.0 },
              range: '<2.0.0'
            }
          ],
          range: '<2.0.0',
          fixAvailable: '2.0.0'
        }
      }
    };
    writeFileSync(join(dir, 'npm-audit.json'), JSON.stringify(data));
    const r = parseNpm(dir);
    assert.equal(r.state, 'ok');
    assert.equal(r.rows.length, 1);
    const row = r.rows[0];
    assert.equal(row.severity, 'med');
    assert.equal(row.cvss, 5.0);
    assert.equal(row.fixed, '2.0.0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps info severity to low and handles fixAvailable as string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseNpm-'));
  try {
    const data = {
      vulnerabilities: {
        'pkg': {
          severity: 'info',
          via: [
            {
              source: 'npm:GHSA-xyz',
              url: 'https://github.com/advisories/GHSA-xyz',
              name: 'pkg',
              title: 'Info issue',
              severity: 'info',
              cvss: { score: 0.1 },
              range: '<1.0.0'
            }
          ],
          range: '<1.0.0',
          fixAvailable: '1.0.0'
        }
      }
    };
    writeFileSync(join(dir, 'npm-audit.json'), JSON.stringify(data));
    const r = parseNpm(dir);
    assert.equal(r.state, 'ok');
    assert.equal(r.rows.length, 1);
    const row = r.rows[0];
    assert.equal(row.severity, 'low');
    assert.equal(row.cvss, 0.1);
    assert.equal(row.fixed, '1.0.0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filters out non-object via entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseNpm-'));
  try {
    const data = {
      vulnerabilities: {
        'pkg': {
          severity: 'high',
          via: [
            'some-string-entry',
            42,
            {
              source: 'npm:GHSA-real',
              url: 'https://github.com/advisories/GHSA-real',
              name: 'pkg',
              title: 'Real advisory',
              severity: 'high',
              cvss: { score: 8.0 },
              range: '<3.0.0'
            }
          ],
          range: '<3.0.0',
          fixAvailable: { name: 'pkg', version: '3.0.0' }
        }
      }
    };
    writeFileSync(join(dir, 'npm-audit.json'), JSON.stringify(data));
    const r = parseNpm(dir);
    assert.equal(r.state, 'ok');
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].id, 'GHSA-real');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles multiple vulnerabilities producing multiple rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseNpm-'));
  try {
    const data = {
      vulnerabilities: {
        'alpha': {
          severity: 'low',
          via: [],
          range: '<1.0.0',
          fixAvailable: false
        },
        'beta': {
          severity: 'critical',
          via: [
            {
              source: 'npm:GHSA-beta1',
              url: 'https://github.com/advisories/GHSA-beta1',
              name: 'beta',
              title: 'Beta issue',
              severity: 'critical',
              cvss: { score: 9.9 },
              range: '<2.0.0'
            }
          ],
          range: '<2.0.0',
          fixAvailable: { name: 'beta', version: '2.0.0' }
        }
      }
    };
    writeFileSync(join(dir, 'npm-audit.json'), JSON.stringify(data));
    const r = parseNpm(dir);
    assert.equal(r.state, 'ok');
    assert.equal(r.rows.length, 2);
    assert.equal(r.rows[0].id, 'alpha');
    assert.equal(r.rows[0].severity, 'low');
    assert.equal(r.rows[0].fixed, '');
    assert.equal(r.rows[1].id, 'GHSA-beta1');
    assert.equal(r.rows[1].severity, 'crit');
    assert.equal(r.rows[1].fixed, 'beta@2.0.0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
