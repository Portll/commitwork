// Counts commit-velocity findings by severity and worktree (monitor/extractors/history.mjs _commitVelocityCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _commitVelocityCounts } from '../extractors/history.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_commitVelocityCounts-'));
  try {
    const got = _commitVelocityCounts(dir, 'missing.json');
    assert.equal(got, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero with nosrc when the file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), '_commitVelocityCounts-'));
  try {
    writeFileSync(join(dir, 'v.json'), '');
    const got = _commitVelocityCounts(dir, 'v.json');
    assert.deepEqual(got, {
      crit: 0, high: 0, med: 0, low: 0, total: 0,
      ran: true, nosrc: true
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero with unparseable when the file is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), '_commitVelocityCounts-'));
  try {
    writeFileSync(join(dir, 'v.json'), '{ not json');
    const got = _commitVelocityCounts(dir, 'v.json');
    assert.deepEqual(got, {
      crit: 0, high: 0, med: 0, low: 0, total: 0,
      ran: true, unparseable: true
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero with unparseable when the tool field is wrong', () => {
  const dir = mkdtempSync(join(tmpdir(), '_commitVelocityCounts-'));
  try {
    writeFileSync(join(dir, 'v.json'), JSON.stringify({ tool: 'other', summary: { filesScanned: 5 }, findings: [] }));
    const got = _commitVelocityCounts(dir, 'v.json');
    assert.deepEqual(got, {
      crit: 0, high: 0, med: 0, low: 0, total: 0,
      ran: true, unparseable: true
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero with nosrc when filesScanned is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), '_commitVelocityCounts-'));
  try {
    writeFileSync(join(dir, 'v.json'), JSON.stringify({ tool: 'commit-velocity', summary: { filesScanned: 0 }, findings: [] }));
    const got = _commitVelocityCounts(dir, 'v.json');
    assert.deepEqual(got, {
      crit: 0, high: 0, med: 0, low: 0, total: 0,
      ran: true, nosrc: true
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero with nosrc when filesScanned is negative', () => {
  const dir = mkdtempSync(join(tmpdir(), '_commitVelocityCounts-'));
  try {
    writeFileSync(join(dir, 'v.json'), JSON.stringify({ tool: 'commit-velocity', summary: { filesScanned: -3 }, findings: [] }));
    const got = _commitVelocityCounts(dir, 'v.json');
    assert.deepEqual(got, {
      crit: 0, high: 0, med: 0, low: 0, total: 0,
      ran: true, nosrc: true
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts findings by severity and returns detail', () => {
  const dir = mkdtempSync(join(tmpdir(), '_commitVelocityCounts-'));
  try {
    const data = {
      tool: 'commit-velocity',
      summary: { filesScanned: 10 },
      findings: [
        { rule: 'r1', path: 'a.js', sev: 'critical', cwe: 'CWE-1', detail: 'msg1' },
        { rule: 'r2', path: 'b.js', sev: 'HIGH', cwe: 'CWE-2', detail: 'msg2' },
        { rule: 'r3', path: 'c.js', sev: 'medium', cwe: 'CWE-3', detail: 'msg3' },
        { rule: 'r4', path: 'd.js', sev: 'low', cwe: 'CWE-4', detail: 'msg4' },
        { rule: 'r5', path: 'e.js', sev: 'unknown', cwe: 'CWE-5', detail: 'msg5' }
      ]
    };
    writeFileSync(join(dir, 'v.json'), JSON.stringify(data));
    const got = _commitVelocityCounts(dir, 'v.json');
    assert.equal(got.ran, true);
    assert.equal(got.filesScanned, 10);
    assert.equal(got.crit, 1);
    assert.equal(got.high, 1);
    assert.equal(got.med, 2);
    assert.equal(got.low, 1);
    assert.equal(got.total, 5);
    assert.equal(got.findings.length, 5);
    assert.equal(got.findings[0].sev, 'crit');
    assert.equal(got.findings[1].sev, 'high');
    assert.equal(got.findings[2].sev, 'med');
    assert.equal(got.findings[3].sev, 'low');
    assert.equal(got.findings[4].sev, 'med');
    assert.equal(got.findings[0].rule, 'r1');
    assert.equal(got.findings[0].file, 'a.js');
    assert.equal(got.findings[0].cwe, 'CWE-1');
    assert.equal(got.findings[0].message, 'msg1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips null findings in the array', () => {
  const dir = mkdtempSync(join(tmpdir(), '_commitVelocityCounts-'));
  try {
    const data = {
      tool: 'commit-velocity',
      summary: { filesScanned: 5 },
      findings: [null, { rule: 'r1', path: 'a.js', sev: 'crit', cwe: 'CWE-1', detail: 'msg1' }]
    };
    writeFileSync(join(dir, 'v.json'), JSON.stringify(data));
    const got = _commitVelocityCounts(dir, 'v.json');
    assert.equal(got.total, 1);
    assert.equal(got.crit, 1);
    assert.equal(got.findings.length, 1);
    assert.equal(got.findings[0].rule, 'r1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
