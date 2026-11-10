// Counts vendor scan findings by severity and flags unparseable or skipped scans (monitor/extractors/tree-contents.mjs _vendorCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _vendorCounts } from '../extractors/tree-contents.mjs';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_vendorCounts-'));
  try {
    const result = _vendorCounts(dir, 'vendor-scan.json');
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty artifact when the file is blank', () => {
  const dir = mkdtempSync(join(tmpdir(), '_vendorCounts-'));
  try {
    writeFileSync(join(dir, 'vendor-scan.json'), '   \n  ');
    const result = _vendorCounts(dir, 'vendor-scan.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flags unparseable JSON with ran true', () => {
  const dir = mkdtempSync(join(tmpdir(), '_vendorCounts-'));
  try {
    writeFileSync(join(dir, 'vendor-scan.json'), '{ not valid json');
    const result = _vendorCounts(dir, 'vendor-scan.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('honours ran false as a void scan with the reason', () => {
  const dir = mkdtempSync(join(tmpdir(), '_vendorCounts-'));
  try {
    writeFileSync(join(dir, 'vendor-scan.json'), JSON.stringify({ ran: false, reason: 'db unreachable' }));
    const result = _vendorCounts(dir, 'vendor-scan.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: false, noscan: true, reason: "db unreachable" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts findings by severity and reports unidentified count', () => {
  const dir = mkdtempSync(join(tmpdir(), '_vendorCounts-'));
  try {
    const findings = [
      { package: 'a', version: '1.0.0', file: 'a.js', id: 'id-a', severity: 'CRITICAL', severitySource: 'db', severityReason: 'r1', cvssVia: 'v1', cwe: 'CWE-1', cwePillar: 'p1', capec: 'c1', capecVia: 'cv1', attack: 'at1', attackTactic: 'tac1', capecReason: 'cr1', summary: 's1' },
      { package: 'b', version: '2.0.0', file: 'b.js', id: 'id-b', severity: 'medium', severitySource: 'db', severityReason: 'r2', cvssVia: 'v2', cwe: 'CWE-2', cwePillar: 'p2', capec: 'c2', capecVia: 'cv2', attack: 'at2', attackTactic: 'tac2', capecReason: 'cr2', summary: 's2' },
      { package: 'c', version: '3.0.0', file: 'c.js', id: 'id-c', severity: 'unknown', severitySource: 'db', severityReason: 'r3', cvssVia: 'v3', cwe: 'CWE-3', cwePillar: 'p3', capec: 'c3', capecVia: 'cv3', attack: 'at3', attackTactic: 'tac3', capecReason: 'cr3', summary: 's3' }
    ];
    writeFileSync(join(dir, 'vendor-scan.json'), JSON.stringify({ ran: true, findings, unidentified: ['x.js', 'y.js'] }));
    const result = _vendorCounts(dir, 'vendor-scan.json');
    assert.deepEqual(result, { crit: 1, high: 0, med: 1, low: 0, total: 3, ran: true, undetermined: 1, unidentified: 2, findings: [{ package: "a", version: "1.0.0", file: "a.js", id: "id-a", sev: "crit", severitySource: "db", severityReason: "r1", cvssVia: "v1", cwe: "CWE-1", cwePillar: "p1", capec: "c1", capecVia: "cv1", attack: "at1", attackTactic: "tac1", capecReason: "cr1", summary: "s1" }, { package: "b", version: "2.0.0", file: "b.js", id: "id-b", sev: "med", severitySource: "db", severityReason: "r2", cvssVia: "v2", cwe: "CWE-2", cwePillar: "p2", capec: "c2", capecVia: "cv2", attack: "at2", attackTactic: "tac2", capecReason: "cr2", summary: "s2" }, { package: "c", version: "3.0.0", file: "c.js", id: "id-c", sev: "", severitySource: "db", severityReason: "r3", cvssVia: "v3", cwe: "CWE-3", cwePillar: "p3", capec: "c3", capecVia: "cv3", attack: "at3", attackTactic: "tac3", capecReason: "cr3", summary: "s3" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('treats a null finding entry as all empty fields', () => {
  const dir = mkdtempSync(join(tmpdir(), '_vendorCounts-'));
  try {
    writeFileSync(join(dir, 'vendor-scan.json'), JSON.stringify({ ran: true, findings: [null], unidentified: [] }));
    const result = _vendorCounts(dir, 'vendor-scan.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 1, ran: true, undetermined: 1, unidentified: 0, findings: [{ package: "", version: "", file: "", id: "", sev: "", severitySource: "", severityReason: "", cvssVia: "", cwe: "", cwePillar: "", capec: "", capecVia: "", attack: "", attackTactic: "", capecReason: "", summary: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('treats a missing findings array as zero findings', () => {
  const dir = mkdtempSync(join(tmpdir(), '_vendorCounts-'));
  try {
    writeFileSync(join(dir, 'vendor-scan.json'), JSON.stringify({ ran: true, unidentified: ['z.js'] }));
    const result = _vendorCounts(dir, 'vendor-scan.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, undetermined: 0, unidentified: 1, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('treats a missing unidentified field as zero unidentified', () => {
  const dir = mkdtempSync(join(tmpdir(), '_vendorCounts-'));
  try {
    writeFileSync(join(dir, 'vendor-scan.json'), JSON.stringify({ ran: true, findings: [] }));
    const result = _vendorCounts(dir, 'vendor-scan.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, undetermined: 0, unidentified: 0, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
