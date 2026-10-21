// Counts commit provenance findings by severity bucket (monitor/extractors/history.mjs _commitProvenanceCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _commitProvenanceCounts } from '../extractors/history.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_commitProvenanceCounts-'));
  try {
    const result = _commitProvenanceCounts(dir, 'missing.json');
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero with nosrc when file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), '_commitProvenanceCounts-'));
  try {
    writeFileSync(join(dir, 'data.json'), '');
    const result = _commitProvenanceCounts(dir, 'data.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero with unparseable when JSON is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), '_commitProvenanceCounts-'));
  try {
    writeFileSync(join(dir, 'data.json'), '{invalid json');
    const result = _commitProvenanceCounts(dir, 'data.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero with unparseable when tool field is wrong', () => {
  const dir = mkdtempSync(join(tmpdir(), '_commitProvenanceCounts-'));
  try {
    writeFileSync(join(dir, 'data.json'), JSON.stringify({ tool: 'other', summary: { commitsScanned: 5 }, findings: [] }));
    const result = _commitProvenanceCounts(dir, 'data.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero with noscan when couldNotRun is set', () => {
  const dir = mkdtempSync(join(tmpdir(), '_commitProvenanceCounts-'));
  try {
    writeFileSync(join(dir, 'data.json'), JSON.stringify({ tool: 'commit-provenance', summary: { couldNotRun: 'git not found' }, findings: [] }));
    const result = _commitProvenanceCounts(dir, 'data.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, noscan: true, noscanReason: 'git not found' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero with nosrc when commitsScanned is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), '_commitProvenanceCounts-'));
  try {
    writeFileSync(join(dir, 'data.json'), JSON.stringify({ tool: 'commit-provenance', summary: { commitsScanned: 0 }, findings: [] }));
    const result = _commitProvenanceCounts(dir, 'data.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts findings by severity and includes details', () => {
  const dir = mkdtempSync(join(tmpdir(), '_commitProvenanceCounts-'));
  try {
    const data = {
      tool: 'commit-provenance',
      summary: { commitsScanned: 3 },
      findings: [
        { rule: 'r1', path: 'a.js', sha: 'abc', sev: 'high', cwe: 'CWE-1', detail: 'msg1' },
        { rule: 'r2', path: 'b.js', sha: 'def', sev: 'low', cwe: 'CWE-2', detail: 'msg2' },
        { rule: 'r3', path: 'c.js', sha: 'ghi', sev: 'med', cwe: 'CWE-3', detail: 'msg3' }
      ]
    };
    writeFileSync(join(dir, 'data.json'), JSON.stringify(data));
    const result = _commitProvenanceCounts(dir, 'data.json');
    assert.equal(result.crit, 0);
    assert.equal(result.high, 1);
    assert.equal(result.med, 1);
    assert.equal(result.low, 1);
    assert.equal(result.total, 3);
    assert.equal(result.commitsScanned, 3);
    assert.equal(result.findings.length, 3);
    assert.equal(result.findings[0].rule, 'r1');
    assert.equal(result.findings[0].sev, 'high');
    assert.equal(result.findings[1].rule, 'r2');
    assert.equal(result.findings[1].sev, 'low');
    assert.equal(result.findings[2].rule, 'r3');
    assert.equal(result.findings[2].sev, 'med');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts findings with unknown severity as undetermined', () => {
  const dir = mkdtempSync(join(tmpdir(), '_commitProvenanceCounts-'));
  try {
    const data = {
      tool: 'commit-provenance',
      summary: { commitsScanned: 2 },
      findings: [
        { rule: 'r1', path: 'a.js', sha: 'abc', sev: 'unknown', cwe: '', detail: 'msg1' },
        { rule: 'r2', path: 'b.js', sha: 'def', sev: '', cwe: '', detail: 'msg2' }
      ]
    };
    writeFileSync(join(dir, 'data.json'), JSON.stringify(data));
    const result = _commitProvenanceCounts(dir, 'data.json');
    assert.equal(result.crit, 0);
    assert.equal(result.high, 0);
    assert.equal(result.med, 0);
    assert.equal(result.low, 0);
    assert.equal(result.total, 0);
    assert.equal(result.undetermined, 2);
    assert.equal(result.commitsScanned, 2);
    assert.equal(result.findings.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes rulesNotApplicable and unmeasured when present', () => {
  const dir = mkdtempSync(join(tmpdir(), '_commitProvenanceCounts-'));
  try {
    const data = {
      tool: 'commit-provenance',
      summary: { commitsScanned: 1, rulesNotApplicable: ['ruleA'], unmeasured: ['ruleB'] },
      findings: [
        { rule: 'r1', path: 'a.js', sha: 'abc', sev: 'high', cwe: 'CWE-1', detail: 'msg1' }
      ]
    };
    writeFileSync(join(dir, 'data.json'), JSON.stringify(data));
    const result = _commitProvenanceCounts(dir, 'data.json');
    assert.deepEqual(result.rulesNotApplicable, ['ruleA']);
    assert.deepEqual(result.unmeasured, ['ruleB']);
    assert.equal(result.high, 1);
    assert.equal(result.total, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses filesScanned when commitsScanned is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), '_commitProvenanceCounts-'));
  try {
    const data = {
      tool: 'commit-provenance',
      summary: { filesScanned: 7 },
      findings: [
        { rule: 'r1', path: 'a.js', sha: 'abc', sev: 'low', cwe: '', detail: 'msg1' }
      ]
    };
    writeFileSync(join(dir, 'data.json'), JSON.stringify(data));
    const result = _commitProvenanceCounts(dir, 'data.json');
    assert.equal(result.commitsScanned, 7);
    assert.equal(result.low, 1);
    assert.equal(result.total, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
