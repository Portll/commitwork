// Counts weak-random findings, splitting test-context rows from high-severity findings (monitor/extractors/secrets.mjs _weakRandomCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _weakRandomCounts } from '../extractors/secrets.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_weakRandomCounts-'));
  try {
    const result = _weakRandomCounts(dir, 'missing.json');
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable with ran true when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), '_weakRandomCounts-'));
  try {
    writeFileSync(join(dir, 'bad.json'), 'not json');
    const result = _weakRandomCounts(dir, 'bad.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable with ran true when the tool field is wrong', () => {
  const dir = mkdtempSync(join(tmpdir(), '_weakRandomCounts-'));
  try {
    writeFileSync(join(dir, 'wrong-tool.json'), JSON.stringify({ tool: 'other', findings: [] }));
    const result = _weakRandomCounts(dir, 'wrong-tool.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns nosrc with ran true when filesScanned is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), '_weakRandomCounts-'));
  try {
    writeFileSync(join(dir, 'zero.json'), JSON.stringify({ tool: 'weak-random-detect', findings: [], summary: { filesScanned: 0 } }));
    const result = _weakRandomCounts(dir, 'zero.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns nosrc with ran true when filesScanned is negative', () => {
  const dir = mkdtempSync(join(tmpdir(), '_weakRandomCounts-'));
  try {
    writeFileSync(join(dir, 'neg.json'), JSON.stringify({ tool: 'weak-random-detect', findings: [], summary: { filesScanned: -1 } }));
    const result = _weakRandomCounts(dir, 'neg.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts one high finding and one test row with filesScanned one', () => {
  const dir = mkdtempSync(join(tmpdir(), '_weakRandomCounts-'));
  try {
    const findings = [
      { rule: 'R1', path: 'a.js', line: 10, context: 'prod', fn: 'gen', why: 'weak seed' },
      { rule: 'R2', path: 'b.js', line: 20, context: 'test', fn: 'bench', why: 'fixed seed' }
    ];
    writeFileSync(join(dir, 'mixed.json'), JSON.stringify({ tool: 'weak-random-detect', findings, summary: { filesScanned: 1 } }));
    const result = _weakRandomCounts(dir, 'mixed.json');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, undetermined: 1, testContextNote: "1 row(s) in test/bench/fixture paths \u2014 deterministic randomness is correct there, so they are counted apart rather than published as findings.", filesScanned: 1, findings: [{ rule: "R1", file: "a.js", line: 10, sev: "high", context: "prod", fn: "gen", message: "weak seed" }, { rule: "R2", file: "b.js", line: 20, sev: "", context: "test", fn: "bench", message: "fixed seed" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts only high findings when no test rows are present', () => {
  const dir = mkdtempSync(join(tmpdir(), '_weakRandomCounts-'));
  try {
    const findings = [
      { rule: 'R1', path: 'a.js', line: 5, context: 'prod', fn: 'gen', why: 'rand' },
      { rule: 'R2', path: 'b.js', line: 6, context: 'prod', fn: 'gen', why: 'rand' }
    ];
    writeFileSync(join(dir, 'prod.json'), JSON.stringify({ tool: 'weak-random-detect', findings, summary: { filesScanned: 2 } }));
    const result = _weakRandomCounts(dir, 'prod.json');
    assert.deepEqual(result, { crit: 0, high: 2, med: 0, low: 0, total: 2, ran: true, filesScanned: 2, findings: [{ rule: "R1", file: "a.js", line: 5, sev: "high", context: "prod", fn: "gen", message: "rand" }, { rule: "R2", file: "b.js", line: 6, sev: "high", context: "prod", fn: "gen", message: "rand" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty artifact when the file is whitespace only', () => {
  const dir = mkdtempSync(join(tmpdir(), '_weakRandomCounts-'));
  try {
    writeFileSync(join(dir, 'empty.json'), '   \n  ');
    const result = _weakRandomCounts(dir, 'empty.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
