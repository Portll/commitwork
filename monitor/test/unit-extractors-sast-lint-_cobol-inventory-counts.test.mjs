// Counts COBOL coverage rows from a cobolwork inventory file (monitor/extractors/sast-lint.mjs _cobolInventoryCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _cobolInventoryCounts } from '../extractors/sast-lint.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the inventory file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_cobolInventoryCounts-'));
  try {
    const result = _cobolInventoryCounts(dir, 'missing.json');
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty artifact when the file is blank', () => {
  const dir = mkdtempSync(join(tmpdir(), '_cobolInventoryCounts-'));
  try {
    writeFileSync(join(dir, 'blank.json'), '   \n  ');
    const result = _cobolInventoryCounts(dir, 'blank.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks unparseable with ran true when the JSON is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), '_cobolInventoryCounts-'));
  try {
    writeFileSync(join(dir, 'bad.json'), '{ not json');
    const result = _cobolInventoryCounts(dir, 'bad.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks unparseable with ran true when the summary is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), '_cobolInventoryCounts-'));
  try {
    writeFileSync(join(dir, 'nosummary.json'), JSON.stringify({ schemaVersion: 2 }));
    const result = _cobolInventoryCounts(dir, 'nosummary.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks unparseable with a reason when schemaVersion is below 2', () => {
  const dir = mkdtempSync(join(tmpdir(), '_cobolInventoryCounts-'));
  try {
    writeFileSync(join(dir, 'old.json'), JSON.stringify({ schemaVersion: 1, summary: { filesScanned: 5 } }));
    const result = _cobolInventoryCounts(dir, 'old.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true, reason: "cobolwork schemaVersion 1 < 2" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks nosrc when filesScanned is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), '_cobolInventoryCounts-'));
  try {
    writeFileSync(join(dir, 'zero.json'), JSON.stringify({ schemaVersion: 2, summary: { filesScanned: 0 } }));
    const result = _cobolInventoryCounts(dir, 'zero.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts missing copybooks and unreadable entries as undetermined', () => {
  const dir = mkdtempSync(join(tmpdir(), '_cobolInventoryCounts-'));
  try {
    const inv = {
      schemaVersion: 2,
      summary: { filesScanned: 3, formats: { 'COBOL-85': 2 } },
      missingCopybooks: { 'CUST-REC': 1, 'ADDR-REC': 4 },
      unreadable: ['src/PROG1.cbl: EBCDIC', 'src/PROG2.cbl']
    };
    writeFileSync(join(dir, 'inv.json'), JSON.stringify(inv));
    const result = _cobolInventoryCounts(dir, 'inv.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, undetermined: 5, findings: [{ kind: "missing-copybook", name: "ADDR-REC", count: 4, message: "COPY ADDR-REC resolves to no copybook in this tree (4 statements). The fields it defines were never read, so every check that needs one of them is blind on those programs." }, { kind: "missing-copybook", name: "CUST-REC", count: 1, message: "COPY CUST-REC resolves to no copybook in this tree (1 statement). The fields it defines were never read, so every check that needs one of them is blind on those programs." }, { kind: "source-format", name: "COBOL-85", count: 2, message: "2 file(s) parsed as COBOL-85 reference format. A file read under the wrong format parses into something that is not the program anyone wrote." }, { kind: "unreadable", name: "src/PROG1.cbl", count: 1, message: "not read: EBCDIC \u2014 an EBCDIC-converted source or a binary member carrying a COBOL extension reads the same way here as a genuine read failure, so this is coverage unknown, not coverage clean." }, { kind: "unreadable", name: "src/PROG2.cbl", count: 1, message: "not read \u2014 an EBCDIC-converted source or a binary member carrying a COBOL extension reads the same way here as a genuine read failure, so this is coverage unknown, not coverage clean." }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero undetermined when no coverage rows are present', () => {
  const dir = mkdtempSync(join(tmpdir(), '_cobolInventoryCounts-'));
  try {
    const inv = { schemaVersion: 2, summary: { filesScanned: 1 } };
    writeFileSync(join(dir, 'clean.json'), JSON.stringify(inv));
    const result = _cobolInventoryCounts(dir, 'clean.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, undetermined: 0, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
