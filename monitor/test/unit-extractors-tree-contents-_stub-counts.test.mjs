// Computes stub-detect finding counts with context-aware filtering (monitor/extractors/tree-contents.mjs _stubCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _stubCounts } from '../extractors/tree-contents.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_stubCounts-'));
  try {
    const result = _stubCounts(dir, 'missing.json');
    assert.strictEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty artifact when file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), '_stubCounts-'));
  try {
    writeFileSync(join(dir, 'empty.json'), '');
    const result = _stubCounts(dir, 'empty.json');
    assert.strictEqual(result.ran, true);
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.crit, 0);
    assert.strictEqual(result.high, 0);
    assert.strictEqual(result.med, 0);
    assert.strictEqual(result.low, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable flag when JSON is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), '_stubCounts-'));
  try {
    writeFileSync(join(dir, 'bad.json'), 'not valid json');
    const result = _stubCounts(dir, 'bad.json');
    assert.strictEqual(result.ran, true);
    assert.strictEqual(result.unparseable, true);
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.crit, 0);
    assert.strictEqual(result.high, 0);
    assert.strictEqual(result.med, 0);
    assert.strictEqual(result.low, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts when findings array is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), '_stubCounts-'));
  try {
    writeFileSync(join(dir, 'nofindings.json'), JSON.stringify({ summary: 'test' }));
    const result = _stubCounts(dir, 'nofindings.json');
    assert.strictEqual(result.ran, true);
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.crit, 0);
    assert.strictEqual(result.high, 0);
    assert.strictEqual(result.med, 0);
    assert.strictEqual(result.low, 0);
    assert.strictEqual(result.undetermined, undefined);
    assert.strictEqual(result.codeContextNote, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts findings without context key as normal findings', () => {
  const dir = mkdtempSync(join(tmpdir(), '_stubCounts-'));
  try {
    const data = {
      summary: 'test',
      findings: [
        { type: 'todo', marker: 'TODO', severity: 'low', path: 'a.js', line: 1, detail: 'fix this' },
        { type: 'fixme', marker: 'FIXME', severity: 'high', path: 'b.js', line: 2, detail: 'fix that' }
      ]
    };
    writeFileSync(join(dir, 'vintage.json'), JSON.stringify(data));
    const result = _stubCounts(dir, 'vintage.json');
    assert.strictEqual(result.ran, true);
    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.low, 1);
    assert.strictEqual(result.high, 1);
    assert.strictEqual(result.crit, 0);
    assert.strictEqual(result.med, 0);
    assert.strictEqual(result.undetermined, undefined);
    assert.strictEqual(result.codeContextNote, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes code context rows from findings and counts them as undetermined', () => {
  const dir = mkdtempSync(join(tmpdir(), '_stubCounts-'));
  try {
    const data = {
      summary: 'test',
      findings: [
        { type: 'todo', marker: 'TODO', severity: 'low', path: 'a.js', line: 1, detail: 'fix this', context: 'comment' },
        { type: 'todo', marker: 'TODO', severity: 'low', path: 'b.js', line: 2, detail: 'in identifier', context: 'code' },
        { type: 'fixme', marker: 'FIXME', severity: 'high', path: 'c.js', line: 3, detail: 'fix that', context: 'code' }
      ]
    };
    writeFileSync(join(dir, 'mixed.json'), JSON.stringify(data));
    const result = _stubCounts(dir, 'mixed.json');
    assert.strictEqual(result.ran, true);
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.low, 1);
    assert.strictEqual(result.high, 0);
    assert.strictEqual(result.crit, 0);
    assert.strictEqual(result.med, 0);
    assert.strictEqual(result.undetermined, 2);
    assert.ok(result.codeContextNote.includes('2 row(s)'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps severity values to canonical buckets', () => {
  const dir = mkdtempSync(join(tmpdir(), '_stubCounts-'));
  try {
    const data = {
      summary: 'test',
      findings: [
        { type: 'stub', marker: 'STUB', severity: 'critical', path: 'a.js', line: 1, detail: 'd1' },
        { type: 'stub', marker: 'STUB', severity: 'CRITICAL', path: 'b.js', line: 2, detail: 'd2' },
        { type: 'stub', marker: 'STUB', severity: 'High', path: 'c.js', line: 3, detail: 'd3' },
        { type: 'stub', marker: 'STUB', severity: 'medium', path: 'd.js', line: 4, detail: 'd4' },
        { type: 'stub', marker: 'STUB', severity: 'med', path: 'e.js', line: 5, detail: 'd5' },
        { type: 'stub', marker: 'STUB', severity: 'LOW', path: 'f.js', line: 6, detail: 'd6' },
        { type: 'stub', marker: 'STUB', severity: 'unknown', path: 'g.js', line: 7, detail: 'd7' }
      ]
    };
    writeFileSync(join(dir, 'sev.json'), JSON.stringify(data));
    const result = _stubCounts(dir, 'sev.json');
    assert.strictEqual(result.ran, true);
    assert.strictEqual(result.total, 7);
    assert.strictEqual(result.crit, 2);
    assert.strictEqual(result.high, 2);
    assert.strictEqual(result.med, 2);
    assert.strictEqual(result.low, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles findings with missing optional fields', () => {
  const dir = mkdtempSync(join(tmpdir(), '_stubCounts-'));
  try {
    const data = {
      summary: 'test',
      findings: [
        { type: 'todo' },
        { marker: 'FIXME' },
        { severity: 'low' },
        null
      ]
    };
    writeFileSync(join(dir, 'sparse.json'), JSON.stringify(data));
    const result = _stubCounts(dir, 'sparse.json');
    assert.strictEqual(result.ran, true);
    assert.strictEqual(result.total, 4);
    assert.strictEqual(result.high, 3);
    assert.strictEqual(result.low, 1);
    assert.strictEqual(result.crit, 0);
    assert.strictEqual(result.med, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
