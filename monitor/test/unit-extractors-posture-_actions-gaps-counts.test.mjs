// computes counts of actions-gaps findings from a JSON report (monitor/extractors/posture.mjs _actionsGapsCounts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _actionsGapsCounts } from '../extractors/posture.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsGapsCounts-'));
  try {
    const result = _actionsGapsCounts(dir, 'missing.json');
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns nosrc when the file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsGapsCounts-'));
  const file = 'empty.json';
  writeFileSync(join(dir, file), '');
  try {
    const result = _actionsGapsCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when JSON cannot be parsed', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsGapsCounts-'));
  const file = 'bad.json';
  writeFileSync(join(dir, file), '{ not: json ');
  try {
    const result = _actionsGapsCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when tool field is wrong', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsGapsCounts-'));
  const file = 'wrongTool.json';
  const payload = {
    tool: 'other-tool',
    summary: { filesScanned: 1 },
    findings: []
  };
  writeFileSync(join(dir, file), JSON.stringify(payload));
  try {
    const result = _actionsGapsCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns nosrc when filesScanned is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsGapsCounts-'));
  const file = 'zeroScanned.json';
  const payload = {
    tool: 'actions-gaps',
    summary: { filesScanned: 0 },
    findings: []
  };
  writeFileSync(join(dir, file), JSON.stringify(payload));
  try {
    const result = _actionsGapsCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('processes a finding with severity and counts by rule', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsGapsCounts-'));
  const file = 'oneFinding.json';
  const payload = {
    tool: 'actions-gaps',
    summary: { filesScanned: 1 },
    findings: [
      { rule: 'R1', sev: 'high', path: 'a.yml', job: 'build', step: 'run', line: 10, cwe: 'CWE-1', detail: 'msg' }
    ]
  };
  writeFileSync(join(dir, file), JSON.stringify(payload));
  try {
    const result = _actionsGapsCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, filesScanned: 1, byRule: { R1: { count: 1, sev: "high" } }, findings: [{ rule: "R1", file: "a.yml", job: "build", step: "run", line: 10, sev: "high", cwe: "CWE-1", message: "msg" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts undetermined severity when sev field is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsGapsCounts-'));
  const file = 'undetermined.json';
  const payload = {
    tool: 'actions-gaps',
    summary: { filesScanned: 1 },
    findings: [
      { rule: 'R2', path: 'b.yml' }
    ]
  };
  writeFileSync(join(dir, file), JSON.stringify(payload));
  try {
    const result = _actionsGapsCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, filesScanned: 1, undetermined: 1, byRule: { R2: { count: 1, sev: "" } }, findings: [{ rule: "R2", file: "b.yml", job: "", step: "", line: 0, sev: "", cwe: "", message: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips non\u2011object findings and continues processing others', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsGapsCounts-'));
  const file = 'mixedFindings.json';
  const payload = {
    tool: 'actions-gaps',
    summary: { filesScanned: 2 },
    findings: [
      null,
      { rule: 'R3', sev: 'low', path: 'c.yml' },
      42
    ]
  };
  writeFileSync(join(dir, file), JSON.stringify(payload));
  try {
    const result = _actionsGapsCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 1, total: 1, ran: true, filesScanned: 2, byRule: { R3: { count: 1, sev: "low" } }, findings: [{ rule: "R3", file: "c.yml", job: "", step: "", line: 0, sev: "low", cwe: "", message: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes partial information when summary reports unparseable and unreadable workflows', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsGapsCounts-'));
  const file = 'partial.json';
  const payload = {
    tool: 'actions-gaps',
    summary: { filesScanned: 1, unparseable: 2, unreadable: 3 },
    findings: [
      { rule: 'R4', sev: 'crit', path: 'd.yml' }
    ]
  };
  writeFileSync(join(dir, file), JSON.stringify(payload));
  try {
    const result = _actionsGapsCounts(dir, file);
    assert.deepEqual(result, { crit: 1, high: 0, med: 0, low: 0, total: 1, ran: true, filesScanned: 1, byRule: { R4: { count: 1, sev: "crit" } }, partial: { unparseable: 2, unreadable: 3, note: "2 workflow(s) did not parse and 3 could not be read; none of them was judged, so these counts are a floor." }, findings: [{ rule: "R4", file: "d.yml", job: "", step: "", line: 0, sev: "crit", cwe: "", message: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles filesScanned equal to 1 (boundary for later edit)', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionsGapsCounts-'));
  const file = 'oneScanned.json';
  const payload = {
    tool: 'actions-gaps',
    summary: { filesScanned: 1 },
    findings: []
  };
  writeFileSync(join(dir, file), JSON.stringify(payload));
  try {
    const result = _actionsGapsCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, filesScanned: 1, byRule: {}, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
