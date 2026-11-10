// Set of CVE IDs from the local KEV JSON, or null if unreadable or malformed (monitor/app-vuln.mjs loadKevSet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadKevSet } from '../app-vuln.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns a Set of CVE IDs when vulnerabilities is an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadKevSet-'));
  try {
    const data = { vulnerabilities: [{ cveID: 'CVE-2024-0001' }, { cveID: 'CVE-2024-0002' }] };
    writeFileSync(join(dir, 'kev.json'), JSON.stringify(data));
    process.env.CW_APPVULN_KEV = join(dir, 'kev.json');
    const r = loadKevSet();
    assert.deepEqual(r, new Set(["CVE-2024-0001", "CVE-2024-0002"]));
  } finally {
    delete process.env.CW_APPVULN_KEV;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when vulnerabilities is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadKevSet-'));
  try {
    const data = { vulnerabilities: { cveID: 'CVE-2024-0001' } };
    writeFileSync(join(dir, 'kev.json'), JSON.stringify(data));
    process.env.CW_APPVULN_KEV = join(dir, 'kev.json');
    const r = loadKevSet();
    assert.equal(r, null);
  } finally {
    delete process.env.CW_APPVULN_KEV;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadKevSet-'));
  try {
    process.env.CW_APPVULN_KEV = join(dir, 'nonexistent.json');
    const r = loadKevSet();
    assert.equal(r, null);
  } finally {
    delete process.env.CW_APPVULN_KEV;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadKevSet-'));
  try {
    writeFileSync(join(dir, 'kev.json'), '{invalid json');
    process.env.CW_APPVULN_KEV = join(dir, 'kev.json');
    const r = loadKevSet();
    assert.equal(r, null);
  } finally {
    delete process.env.CW_APPVULN_KEV;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filters out entries with falsy cveID values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadKevSet-'));
  try {
    const data = { vulnerabilities: [{ cveID: 'CVE-2024-0001' }, { cveID: '' }, { cveID: null }, { cveID: 'CVE-2024-0003' }] };
    writeFileSync(join(dir, 'kev.json'), JSON.stringify(data));
    process.env.CW_APPVULN_KEV = join(dir, 'kev.json');
    const r = loadKevSet();
    assert.deepEqual(r, new Set(["CVE-2024-0001", "CVE-2024-0003"]));
  } finally {
    delete process.env.CW_APPVULN_KEV;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty Set when vulnerabilities is an empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadKevSet-'));
  try {
    const data = { vulnerabilities: [] };
    writeFileSync(join(dir, 'kev.json'), JSON.stringify(data));
    process.env.CW_APPVULN_KEV = join(dir, 'kev.json');
    const r = loadKevSet();
    assert.deepEqual(r, new Set([]));
  } finally {
    delete process.env.CW_APPVULN_KEV;
    rmSync(dir, { recursive: true, force: true });
  }
});
