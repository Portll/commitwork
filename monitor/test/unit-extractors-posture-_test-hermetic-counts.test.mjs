// Computes hermetic test rule counts from a JSON report file (monitor/extractors/posture.mjs _testHermeticCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _testHermeticCounts } from '../extractors/posture.mjs';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the report file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_testHermeticCounts-'));
  try {
    const result = _testHermeticCounts(dir, 'missing.json');
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts with nosrc flag when file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), '_testHermeticCounts-'));
  try {
    writeFileSync(join(dir, 'empty.json'), '');
    const result = _testHermeticCounts(dir, 'empty.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts with unparseable flag when JSON is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), '_testHermeticCounts-'));
  try {
    writeFileSync(join(dir, 'bad.json'), '{invalid');
    const result = _testHermeticCounts(dir, 'bad.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts with unparseable flag when tool name mismatches', () => {
  const dir = mkdtempSync(join(tmpdir(), '_testHermeticCounts-'));
  try {
    const data = { tool: 'wrong-tool', summary: { filesScanned: 1 }, findings: [] };
    writeFileSync(join(dir, 'wrong.json'), JSON.stringify(data));
    const result = _testHermeticCounts(dir, 'wrong.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts with nosrc flag when summary.void is true', () => {
  const dir = mkdtempSync(join(tmpdir(), '_testHermeticCounts-'));
  try {
    const data = { tool: 'test-hermetic', summary: { void: true, voidReason: 'no tests' }, findings: [] };
    writeFileSync(join(dir, 'void.json'), JSON.stringify(data));
    const result = _testHermeticCounts(dir, 'void.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true, nosrcReason: "no tests" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts findings by severity and rule with valid report', () => {
  const dir = mkdtempSync(join(tmpdir(), '_testHermeticCounts-'));
  try {
    const findings = [
      { rule: 'r1', path: 'a.js', test: 't1', sev: 'high', detail: 'msg1' },
      { rule: 'r1', path: 'b.js', test: 't2', sev: 'low', detail: 'msg2' },
      { rule: 'r2', path: 'c.js', test: 't3', sev: 'bad', detail: 'msg3' }
    ];
    const data = { tool: 'test-hermetic', summary: { filesScanned: 3 }, findings };
    writeFileSync(join(dir, 'report.json'), JSON.stringify(data));
    const result = _testHermeticCounts(dir, 'report.json');
    assert.equal(result.ran, true);
    assert.equal(result.filesScanned, 3);
    assert.equal(result.high, 1);
    assert.equal(result.low, 1);
    assert.equal(result.total, 2);
    assert.equal(result.undetermined, 1);
    assert.equal(result.byRule.r1.count, 2);
    assert.equal(result.byRule.r2.count, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles missing summary and findings fields as unparseable', () => {
  const dir = mkdtempSync(join(tmpdir(), '_testHermeticCounts-'));
  try {
    const data = { tool: 'test-hermetic' };
    writeFileSync(join(dir, 'incomplete.json'), JSON.stringify(data));
    const result = _testHermeticCounts(dir, 'incomplete.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
