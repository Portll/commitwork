// counts yara-witness findings and metadata (monitor/extractors/tree-contents.mjs _yaraWitnessCounts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _yaraWitnessCounts } from '../extractors/tree-contents.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_yaraWitnessCounts-'));
  try {
    const result = _yaraWitnessCounts(dir, 'missing.json');
    assert.strictEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ran:true and nosrc:true for empty file', () => {
  const dir = mkdtempSync(join(tmpdir(), '_yaraWitnessCounts-'));
  try {
    writeFileSync(join(dir, 'empty.json'), '');
    const result = _yaraWitnessCounts(dir, 'empty.json');
    assert.deepStrictEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ran:true and unparseable:true for invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), '_yaraWitnessCounts-'));
  try {
    writeFileSync(join(dir, 'bad.json'), '{ bad json ');
    const result = _yaraWitnessCounts(dir, 'bad.json');
    assert.deepStrictEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ran:true and unparseable:true when tool is not yara-witness', () => {
  const dir = mkdtempSync(join(tmpdir(), '_yaraWitnessCounts-'));
  try {
    const payload = JSON.stringify({ tool: 'other', summary: { filesScanned: 1 }, findings: [] });
    writeFileSync(join(dir, 'wrongtool.json'), payload);
    const result = _yaraWitnessCounts(dir, 'wrongtool.json');
    assert.deepStrictEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ran:true and nosrc:true when filesScanned is 0', () => {
  const dir = mkdtempSync(join(tmpdir(), '_yaraWitnessCounts-'));
  try {
    const payload = JSON.stringify({ tool: 'yara-witness', summary: { filesScanned: 0 }, findings: [] });
    writeFileSync(join(dir, 'zeroscanned.json'), payload);
    const result = _yaraWitnessCounts(dir, 'zeroscanned.json');
    assert.deepStrictEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ran:true and nosrc:true when filesScanned is negative', () => {
  const dir = mkdtempSync(join(tmpdir(), '_yaraWitnessCounts-'));
  try {
    const payload = JSON.stringify({ tool: 'yara-witness', summary: { filesScanned: -5 }, findings: [] });
    writeFileSync(join(dir, 'negscanned.json'), payload);
    const result = _yaraWitnessCounts(dir, 'negscanned.json');
    assert.deepStrictEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts findings with valid severities and builds byRule and rows', () => {
  const dir = mkdtempSync(join(tmpdir(), '_yaraWitnessCounts-'));
  try {
    const payload = JSON.stringify({
      tool: 'yara-witness',
      summary: { filesScanned: 3 },
      findings: [
        { rule: 'r1', sev: 'crit', cwe: '123', detail: 'msg1', path: 'a' },
        { rule: 'r1', sev: 'crit', detail: 'msg2', path: 'b' },
        { rule: 'r2', sev: 'low', detail: 'msg3', path: 'c' }
      ]
    });
    writeFileSync(join(dir, 'good.json'), payload);
    const result = _yaraWitnessCounts(dir, 'good.json');
    assert.strictEqual(result.ran, true);
    assert.strictEqual(result.filesScanned, 3);
    assert.strictEqual(result.crit, 2);
    assert.strictEqual(result.low, 1);
    assert.strictEqual(result.total, 3);
    assert.strictEqual(result.undetermined, undefined);
    assert.deepStrictEqual(result.byRule, { r1: { count: 2, sev: 'crit' }, r2: { count: 1, sev: 'low' } });
    assert.strictEqual(result.divergence, undefined);
    assert.strictEqual(result.partial, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts findings with invalid severity as undetermined', () => {
  const dir = mkdtempSync(join(tmpdir(), '_yaraWitnessCounts-'));
  try {
    const payload = JSON.stringify({
      tool: 'yara-witness',
      summary: { filesScanned: 2 },
      findings: [
        { rule: 'r1', sev: 'unknown', detail: 'msg1', path: 'a' },
        { rule: 'r2', sev: 'high', detail: 'msg2', path: 'b' }
      ]
    });
    writeFileSync(join(dir, 'undetermined.json'), payload);
    const result = _yaraWitnessCounts(dir, 'undetermined.json');
    assert.strictEqual(result.high, 1);
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.undetermined, 1);
    assert.deepStrictEqual(result.byRule, { r1: { count: 1, sev: '' }, r2: { count: 1, sev: 'high' } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes divergence and partial metadata when present', () => {
  const dir = mkdtempSync(join(tmpdir(), '_yaraWitnessCounts-'));
  try {
    const payload = JSON.stringify({
      tool: 'yara-witness',
      summary: {
        filesScanned: 2,
        divergence: { both: 1, yaraOnly: { count: 2 }, detectOnly: { count: 0 } },
        partial: true,
        partialReasons: ['reason1', 'reason2']
      },
      findings: []
    });
    writeFileSync(join(dir, 'partial.json'), payload);
    const result = _yaraWitnessCounts(dir, 'partial.json');
    assert.deepStrictEqual(result.divergence, { both: 1, yaraOnly: 2, detectOnly: 0 });
    assert.deepStrictEqual(result.partial, {
      reasons: ['reason1', 'reason2'],
      note: 'yara-x read only part of its input (reason1; reason2), so these counts are a floor.'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adds summary undetermined count to row undetermined count', () => {
  const dir = mkdtempSync(join(tmpdir(), '_yaraWitnessCounts-'));
  try {
    const payload = JSON.stringify({
      tool: 'yara-witness',
      summary: { filesScanned: 2, undetermined: { count: 5 } },
      findings: [
        { rule: 'r1', sev: 'bad', detail: 'msg', path: 'a' }
      ]
    });
    writeFileSync(join(dir, 'undcount.json'), payload);
    const result = _yaraWitnessCounts(dir, 'undcount.json');
    assert.strictEqual(result.undetermined, 6);
    assert.strictEqual(result.total, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
