// Computes a retire.js scan detail object with severity counts and vulnerability rows (monitor/extractors/supply-chain.mjs _retireDetail).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _retireDetail } from '../extractors/supply-chain.mjs';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_retireDetail-'));
  try {
    const result = _retireDetail(dir, 'missing.json');
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when parsed data is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), '_retireDetail-'));
  try {
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ data: 'not-an-array' }));
    const result = _retireDetail(dir, 'bad.json');
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts and empty rows for a clean scan with empty data', () => {
  const dir = mkdtempSync(join(tmpdir(), '_retireDetail-'));
  try {
    writeFileSync(join(dir, 'clean.json'), JSON.stringify({ data: [] }));
    const result = _retireDetail(dir, 'clean.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a critical vulnerability and trims the absolute path to the node_modules segment', () => {
  const dir = mkdtempSync(join(tmpdir(), '_retireDetail-'));
  try {
    const payload = {
      data: [{
        file: '/home/user/project/node_modules/react-quill/dist/react-quill.js',
        results: [{
          component: 'quill',
          version: '1.3.7',
          vulnerabilities: [{
            severity: 'critical',
            identifiers: { CVE: ['CVE-2021-23369'], summary: 'XSS in quill' }
          }]
        }]
      }]
    };
    writeFileSync(join(dir, 'scan.json'), JSON.stringify(payload));
    const result = _retireDetail(dir, 'scan.json');
    assert.deepEqual(result, { crit: 1, high: 0, med: 0, low: 0, total: 1, ran: true, findings: [{ component: "quill", version: "1.3.7", id: "CVE-2021-23369", sev: "crit", file: "node_modules/react-quill/dist/react-quill.js", message: "XSS in quill" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips vulnerabilities with an unrecognized severity', () => {
  const dir = mkdtempSync(join(tmpdir(), '_retireDetail-'));
  try {
    const payload = {
      data: [{
        file: '/home/user/project/node_modules/lib/bundle.js',
        results: [{
          component: 'lib',
          version: '1.0.0',
          vulnerabilities: [{
            severity: 'unknown-sev',
            identifiers: { CVE: ['CVE-0000-0000'], summary: 'weird' }
          }]
        }]
      }]
    };
    writeFileSync(join(dir, 'scan.json'), JSON.stringify(payload));
    const result = _retireDetail(dir, 'scan.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to the last two path segments when no node_modules segment is present', () => {
  const dir = mkdtempSync(join(tmpdir(), '_retireDetail-'));
  try {
    const payload = {
      data: [{
        file: '/opt/vendor/three.min.js',
        results: [{
          component: 'three',
          version: '0.128.0',
          vulnerabilities: [{
            severity: 'high',
            identifiers: { githubID: 'GHSA-abc', summary: 'prototype pollution' }
          }]
        }]
      }]
    };
    writeFileSync(join(dir, 'scan.json'), JSON.stringify(payload));
    const result = _retireDetail(dir, 'scan.json');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, findings: [{ component: "three", version: "0.128.0", id: "GHSA-abc", sev: "high", file: "vendor/three.min.js", message: "prototype pollution" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses the first CVE when identifiers has a CVE array and no githubID', () => {
  const dir = mkdtempSync(join(tmpdir(), '_retireDetail-'));
  try {
    const payload = {
      data: [{
        file: '/home/user/node_modules/pkg/dist/index.js',
        results: [{
          component: 'pkg',
          version: '2.0.0',
          vulnerabilities: [{
            severity: 'medium',
            identifiers: { CVE: ['CVE-2020-1111', 'CVE-2020-2222'], summary: 'denial of service' }
          }]
        }]
      }]
    };
    writeFileSync(join(dir, 'scan.json'), JSON.stringify(payload));
    const result = _retireDetail(dir, 'scan.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 1, low: 0, total: 1, ran: true, findings: [{ component: "pkg", version: "2.0.0", id: "CVE-2020-1111", sev: "med", file: "node_modules/pkg/dist/index.js", message: "denial of service" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to issue identifier when no CVE or githubID is present', () => {
  const dir = mkdtempSync(join(tmpdir(), '_retireDetail-'));
  try {
    const payload = {
      data: [{
        file: '/home/user/node_modules/old-lib/lib.js',
        results: [{
          component: 'old-lib',
          version: '0.9.0',
          vulnerabilities: [{
            severity: 'low',
            identifiers: { issue: 'ISSUE-42', summary: 'minor bug' }
          }]
        }]
      }]
    };
    writeFileSync(join(dir, 'scan.json'), JSON.stringify(payload));
    const result = _retireDetail(dir, 'scan.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 1, total: 1, ran: true, findings: [{ component: "old-lib", version: "0.9.0", id: "ISSUE-42", sev: "low", file: "node_modules/old-lib/lib.js", message: "minor bug" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles a file path where node_modules appears at index zero', () => {
  const dir = mkdtempSync(join(tmpdir(), '_retireDetail-'));
  try {
    const payload = {
      data: [{
        file: '/node_modules/pkg/dist/bundle.js',
        results: [{
          component: 'pkg',
          version: '1.1.1',
          vulnerabilities: [{
            severity: 'high',
            identifiers: { CVE: ['CVE-2019-9999'], summary: 'remote code execution' }
          }]
        }]
      }]
    };
    writeFileSync(join(dir, 'scan.json'), JSON.stringify(payload));
    const result = _retireDetail(dir, 'scan.json');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, findings: [{ component: "pkg", version: "1.1.1", id: "CVE-2019-9999", sev: "high", file: "node_modules/pkg/dist/bundle.js", message: "remote code execution" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles a file path where node_modules appears at index one', () => {
  const dir = mkdtempSync(join(tmpdir(), '_retireDetail-'));
  try {
    const payload = {
      data: [{
        file: 'x/node_modules/pkg/dist/bundle.js',
        results: [{
          component: 'pkg',
          version: '1.1.1',
          vulnerabilities: [{
            severity: 'medium',
            identifiers: { githubID: 'GHSA-xyz', summary: 'insecure default' }
          }]
        }]
      }]
    };
    writeFileSync(join(dir, 'scan.json'), JSON.stringify(payload));
    const result = _retireDetail(dir, 'scan.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 1, low: 0, total: 1, ran: true, findings: [{ component: "pkg", version: "1.1.1", id: "GHSA-xyz", sev: "med", file: "node_modules/pkg/dist/bundle.js", message: "insecure default" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
