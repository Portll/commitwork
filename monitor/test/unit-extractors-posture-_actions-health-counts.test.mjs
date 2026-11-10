// Computes per-rule severity counts from an actions-health JSON report (monitor/extractors/posture.mjs _actionsHealthCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _actionsHealthCounts } from '../extractors/posture.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the report file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsHealthCounts-'));
  try {
    const result = _actionsHealthCounts(dir, 'actions-health.json');
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a nosrc zero when the report file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsHealthCounts-'));
  try {
    writeFileSync(join(dir, 'actions-health.json'), '');
    const result = _actionsHealthCounts(dir, 'actions-health.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an unparseable zero when the report is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsHealthCounts-'));
  try {
    writeFileSync(join(dir, 'actions-health.json'), 'not json');
    const result = _actionsHealthCounts(dir, 'actions-health.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a nosrc zero when the summary is void with a reason', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsHealthCounts-'));
  try {
    const j = { tool: 'actions-health', summary: { void: true, voidReason: 'no files' }, findings: [] };
    writeFileSync(join(dir, 'actions-health.json'), JSON.stringify(j));
    const result = _actionsHealthCounts(dir, 'actions-health.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true, nosrcReason: "no files" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an unparseable zero when the tool field does not match', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsHealthCounts-'));
  try {
    const j = { tool: 'other', summary: { filesScanned: 1 }, findings: [] };
    writeFileSync(join(dir, 'actions-health.json'), JSON.stringify(j));
    const result = _actionsHealthCounts(dir, 'actions-health.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts findings with a rule and a valid severity', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsHealthCounts-'));
  try {
    const j = {
      tool: 'actions-health',
      summary: { filesScanned: 2 },
      findings: [
        { rule: 'R1', path: 'a.sh', sev: 'high', detail: 'msg1' },
        { rule: 'R1', path: 'b.sh', sev: 'low', detail: 'msg2' },
        { rule: 'R2', path: 'c.sh', sev: 'crit', detail: 'msg3' }
      ]
    };
    writeFileSync(join(dir, 'actions-health.json'), JSON.stringify(j));
    const result = _actionsHealthCounts(dir, 'actions-health.json');
    assert.deepEqual(result, { crit: 1, high: 1, med: 0, low: 1, total: 3, ran: true, filesScanned: 2, byRule: { R1: { count: 2, sev: "high" }, R2: { count: 1, sev: "crit" } }, findings: [{ rule: "R1", file: "a.sh", sev: "high", message: "msg1" }, { rule: "R1", file: "b.sh", sev: "low", message: "msg2" }, { rule: "R2", file: "c.sh", sev: "crit", message: "msg3" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts findings with missing rule and path as empty strings', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsHealthCounts-'));
  try {
    const j = {
      tool: 'actions-health',
      summary: { filesScanned: 1 },
      findings: [
        { sev: 'med', detail: 'no rule or path' },
        { rule: '', path: '', sev: 'low', detail: 'empty strings' }
      ]
    };
    writeFileSync(join(dir, 'actions-health.json'), JSON.stringify(j));
    const result = _actionsHealthCounts(dir, 'actions-health.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 1, low: 1, total: 2, ran: true, filesScanned: 1, byRule: { "": { count: 2, sev: "med" } }, findings: [{ rule: "", file: "", sev: "med", message: "no rule or path" }, { rule: "", file: "", sev: "low", message: "empty strings" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts findings with missing detail as empty message', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsHealthCounts-'));
  try {
    const j = {
      tool: 'actions-health',
      summary: { filesScanned: 1 },
      findings: [
        { rule: 'R1', path: 'a.sh', sev: 'high' },
        { rule: 'R1', path: 'b.sh', sev: 'high', detail: '' }
      ]
    };
    writeFileSync(join(dir, 'actions-health.json'), JSON.stringify(j));
    const result = _actionsHealthCounts(dir, 'actions-health.json');
    assert.deepEqual(result, { crit: 0, high: 2, med: 0, low: 0, total: 2, ran: true, filesScanned: 1, byRule: { R1: { count: 2, sev: "high" } }, findings: [{ rule: "R1", file: "a.sh", sev: "high", message: "" }, { rule: "R1", file: "b.sh", sev: "high", message: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tracks undetermined findings with an invalid severity', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsHealthCounts-'));
  try {
    const j = {
      tool: 'actions-health',
      summary: { filesScanned: 1 },
      findings: [
        { rule: 'R1', path: 'a.sh', sev: 'bogus', detail: 'bad sev' },
        { rule: 'R1', path: 'b.sh', sev: 'high', detail: 'good sev' }
      ]
    };
    writeFileSync(join(dir, 'actions-health.json'), JSON.stringify(j));
    const result = _actionsHealthCounts(dir, 'actions-health.json');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, filesScanned: 1, undetermined: 1, byRule: { R1: { count: 2, sev: "" } }, findings: [{ rule: "R1", file: "a.sh", sev: "", message: "bad sev" }, { rule: "R1", file: "b.sh", sev: "high", message: "good sev" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips non-object entries in findings', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsHealthCounts-'));
  try {
    const j = {
      tool: 'actions-health',
      summary: { filesScanned: 1 },
      findings: [null, 'str', 42, { rule: 'R1', path: 'a.sh', sev: 'low', detail: 'ok' }]
    };
    writeFileSync(join(dir, 'actions-health.json'), JSON.stringify(j));
    const result = _actionsHealthCounts(dir, 'actions-health.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 1, total: 1, ran: true, filesScanned: 1, byRule: { R1: { count: 1, sev: "low" } }, findings: [{ rule: "R1", file: "a.sh", sev: "low", message: "ok" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
