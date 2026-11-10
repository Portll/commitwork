// Computes SAST scan counts from a joern-scan artifact (monitor/extractors/sast-lint.mjs _joernScanCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _joernScanCounts } from '../extractors/sast-lint.mjs';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the artifact file is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), '_joernScanCounts-'));
  try {
    const result = _joernScanCounts(dir, 'joern.txt');
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty artifact when the file is blank', () => {
  const dir = mkdtempSync(join(tmpdir(), '_joernScanCounts-'));
  try {
    writeFileSync(join(dir, 'joern.txt'), '   \n  ');
    const result = _joernScanCounts(dir, 'joern.txt');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when the lane record is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), '_joernScanCounts-'));
  try {
    writeFileSync(join(dir, 'joern.txt'), 'Result: 8.0 : rule : f.c:1:fn\n');
    writeFileSync(join(dir, 'joern-lane.json'), 'not json');
    const result = _joernScanCounts(dir, 'joern.txt');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns toolfailed when no language scanned successfully', () => {
  const dir = mkdtempSync(join(tmpdir(), '_joernScanCounts-'));
  try {
    writeFileSync(join(dir, 'joern.txt'), 'Result: 8.0 : rule : f.c:1:fn\n');
    writeFileSync(join(dir, 'joern-lane.json'), JSON.stringify({ tool: 'joern-lane', languages: [{ id: 'c', scanRan: true, exit: 1 }] }));
    const result = _joernScanCounts(dir, 'joern.txt');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, toolfailed: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns counts with coverage incomplete when some languages failed', () => {
  const dir = mkdtempSync(join(tmpdir(), '_joernScanCounts-'));
  try {
    writeFileSync(join(dir, 'joern.txt'), 'Result: 8.0 : rule : f.c:1:fn\n');
    writeFileSync(join(dir, 'joern-lane.json'), JSON.stringify({ tool: 'joern-lane', languages: [{ id: 'c', scanRan: true, exit: 0 }, { id: 'cpp', scanRan: true, exit: 1, reason: 'crash' }] }));
    const result = _joernScanCounts(dir, 'joern.txt');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, findings: [{ rule: "rule", file: "f.c", line: 1, sev: "high", message: "rule", corroboratedBy: "" }], coverageIncomplete: true, coverage: { state: "partial", languagesScanned: ["c"], languagesFailed: [{ language: "cpp", reason: "crash" }], reason: "1 of 2 language(s) never produced a scan pass (cpp), so this count covers c only. The lane's own exit is non-zero, so the run row carries the reason too." } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns toolfailed when scan did not run and exit is non-zero', () => {
  const dir = mkdtempSync(join(tmpdir(), '_joernScanCounts-'));
  try {
    writeFileSync(join(dir, 'joern.txt'), '[INFO] starting\n');
    writeFileSync(join(dir, 'joern.txt.exit'), '1');
    const result = _joernScanCounts(dir, 'joern.txt');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, toolfailed: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when scan did not run and exit is zero with no error', () => {
  const dir = mkdtempSync(join(tmpdir(), '_joernScanCounts-'));
  try {
    writeFileSync(join(dir, 'joern.txt'), '[INFO] starting\n');
    writeFileSync(join(dir, 'joern.txt.exit'), '0');
    const result = _joernScanCounts(dir, 'joern.txt');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns toolfailed when scan did not run and error marker is present', () => {
  const dir = mkdtempSync(join(tmpdir(), '_joernScanCounts-'));
  try {
    writeFileSync(join(dir, 'joern.txt'), '[ERROR] Process exited with code 1.\n');
    writeFileSync(join(dir, 'joern.txt.exit'), '0');
    const result = _joernScanCounts(dir, 'joern.txt');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, toolfailed: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns counts when scan ran with result lines', () => {
  const dir = mkdtempSync(join(tmpdir(), '_joernScanCounts-'));
  try {
    writeFileSync(join(dir, 'joern.txt'), 'Result: 8.0 : rule : f.c:1:fn\nResult: 4.0 : rule2 : f.c:2:fn\n');
    writeFileSync(join(dir, 'joern.txt.exit'), '0');
    const result = _joernScanCounts(dir, 'joern.txt');
    assert.deepEqual(result, { crit: 0, high: 1, med: 1, low: 0, total: 2, ran: true, findings: [{ rule: "rule", file: "f.c", line: 1, sev: "high", message: "rule", corroboratedBy: "" }, { rule: "rule2", file: "f.c", line: 2, sev: "med", message: "rule2", corroboratedBy: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns counts when scan ran via ScanPass marker only', () => {
  const dir = mkdtempSync(join(tmpdir(), '_joernScanCounts-'));
  try {
    writeFileSync(join(dir, 'joern.txt'), 'ScanPass completed\n');
    writeFileSync(join(dir, 'joern.txt.exit'), '0');
    const result = _joernScanCounts(dir, 'joern.txt');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
