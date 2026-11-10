// WordPress integrity counts (monitor/extractors/supply-chain.mjs _wpIntegrityCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _wpIntegrityCounts } from '../extractors/supply-chain.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('missing file returns null', () => {
  const dir = mkdtempSync(join(tmpdir(), '_wpIntegrityCounts-'));
  try {
    const result = _wpIntegrityCounts(dir, 'integrity.json');
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('empty file returns empty artifact', () => {
  const dir = mkdtempSync(join(tmpdir(), '_wpIntegrityCounts-'));
  try {
    writeFileSync(join(dir, 'integrity.json'), '   \n  ');
    const result = _wpIntegrityCounts(dir, 'integrity.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unparseable JSON returns unparseable', () => {
  const dir = mkdtempSync(join(tmpdir(), '_wpIntegrityCounts-'));
  try {
    writeFileSync(join(dir, 'integrity.json'), '{invalid');
    const result = _wpIntegrityCounts(dir, 'integrity.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('wrong tool returns unparseable', () => {
  const dir = mkdtempSync(join(tmpdir(), '_wpIntegrityCounts-'));
  try {
    const data = { tool: 'other', summary: { filesScanned: 1 }, findings: [] };
    writeFileSync(join(dir, 'integrity.json'), JSON.stringify(data));
    const result = _wpIntegrityCounts(dir, 'integrity.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nosrc when voidReason set and no findings', () => {
  const dir = mkdtempSync(join(tmpdir(), '_wpIntegrityCounts-'));
  try {
    const data = { tool: 'wp-integrity', summary: { filesScanned: 5, voidReason: 'no source' }, findings: [] };
    writeFileSync(join(dir, 'integrity.json'), JSON.stringify(data));
    const result = _wpIntegrityCounts(dir, 'integrity.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true, nosrcReason: "no source" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('finding with missing rule and path fields', () => {
  const dir = mkdtempSync(join(tmpdir(), '_wpIntegrityCounts-'));
  try {
    const data = {
      tool: 'wp-integrity',
      summary: { filesScanned: 2, components: { verified: 1, unverifiable: 0 } },
      findings: [{ sev: 'high', cwe: 'CWE-79', detail: 'x'.repeat(300) }]
    };
    writeFileSync(join(dir, 'integrity.json'), JSON.stringify(data));
    const result = _wpIntegrityCounts(dir, 'integrity.json');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, filesScanned: 2, verified: 1, unverifiable: 0, notMeasured: 0, byRule: { "": { count: 1, sev: "high" } }, findings: [{ rule: "", file: "", sev: "high", cwe: "CWE-79", message: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('finding with missing cwe field', () => {
  const dir = mkdtempSync(join(tmpdir(), '_wpIntegrityCounts-'));
  try {
    const data = {
      tool: 'wp-integrity',
      summary: { filesScanned: 1, components: { verified: 2, unverifiable: 1 } },
      findings: [{ rule: 'R1', path: 'a.php', sev: 'crit', detail: 'msg' }]
    };
    writeFileSync(join(dir, 'integrity.json'), JSON.stringify(data));
    const result = _wpIntegrityCounts(dir, 'integrity.json');
    assert.deepEqual(result, { crit: 1, high: 0, med: 0, low: 0, total: 1, ran: true, filesScanned: 1, verified: 2, unverifiable: 1, notMeasured: 0, byRule: { R1: { count: 1, sev: "crit" } }, findings: [{ rule: "R1", file: "a.php", sev: "crit", cwe: "", message: "msg" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('components as non-object uses empty defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), '_wpIntegrityCounts-'));
  try {
    const data = {
      tool: 'wp-integrity',
      summary: { filesScanned: 3, components: 'not-an-object', notMeasured: ['a', 'b', 'c'] },
      findings: [{ rule: 'R2', path: 'b.php', sev: 'low', cwe: 'CWE-89', detail: 'd' }]
    };
    writeFileSync(join(dir, 'integrity.json'), JSON.stringify(data));
    const result = _wpIntegrityCounts(dir, 'integrity.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 1, total: 1, ran: true, filesScanned: 3, verified: 0, unverifiable: 0, notMeasured: 3, byRule: { R2: { count: 1, sev: "low" } }, findings: [{ rule: "R2", file: "b.php", sev: "low", cwe: "CWE-89", message: "d" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('partial summary with reasons', () => {
  const dir = mkdtempSync(join(tmpdir(), '_wpIntegrityCounts-'));
  try {
    const data = {
      tool: 'wp-integrity',
      summary: { filesScanned: 4, partial: true, partialReasons: ['timeout', 'network'], components: { verified: 3, unverifiable: 2 } },
      findings: [
        { rule: 'R3', path: 'c.php', sev: 'med', cwe: 'CWE-502', detail: 'e' },
        { rule: 'R3', path: 'd.php', sev: '', cwe: '', detail: 'f' }
      ]
    };
    writeFileSync(join(dir, 'integrity.json'), JSON.stringify(data));
    const result = _wpIntegrityCounts(dir, 'integrity.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 1, low: 0, total: 1, ran: true, filesScanned: 4, verified: 3, unverifiable: 2, notMeasured: 0, undetermined: 1, byRule: { R3: { count: 2, sev: "med" } }, partial: { reasons: ["timeout", "network"], note: "wp-integrity measured only part of what it found (timeout; network), so these counts are a floor." }, findings: [{ rule: "R3", file: "c.php", sev: "med", cwe: "CWE-502", message: "e" }, { rule: "R3", file: "d.php", sev: "", cwe: "", message: "f" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
