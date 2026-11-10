// Counts agent-config findings by severity, flags partial/unparseable reads, and reports enforcement state (monitor/extractors/agent-surface.mjs _agentConfigCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _agentConfigCounts } from '../extractors/agent-surface.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_agentConfigCounts-'));
  try {
    assert.equal(_agentConfigCounts(dir, 'missing.json'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns nosrc when the file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), '_agentConfigCounts-'));
  try {
    writeFileSync(join(dir, 'a.json'), '');
    const r = _agentConfigCounts(dir, 'a.json');
    assert.equal(r.ran, true);
    assert.equal(r.nosrc, true);
    assert.equal(r.total, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when the file is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), '_agentConfigCounts-'));
  try {
    writeFileSync(join(dir, 'a.json'), '{bad');
    const r = _agentConfigCounts(dir, 'a.json');
    assert.equal(r.ran, true);
    assert.equal(r.unparseable, true);
    assert.equal(r.total, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when the JSON lacks the agent-config tool marker', () => {
  const dir = mkdtempSync(join(tmpdir(), '_agentConfigCounts-'));
  try {
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ tool: 'other', summary: { filesScanned: 1 }, findings: [] }));
    const r = _agentConfigCounts(dir, 'a.json');
    assert.equal(r.ran, true);
    assert.equal(r.unparseable, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns nosrc when filesScanned is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), '_agentConfigCounts-'));
  try {
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ tool: 'agent-config', summary: { filesScanned: 0 }, findings: [] }));
    const r = _agentConfigCounts(dir, 'a.json');
    assert.equal(r.ran, true);
    assert.equal(r.nosrc, true);
    assert.equal(r.total, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts findings by severity and ignores worktree rows', () => {
  const dir = mkdtempSync(join(tmpdir(), '_agentConfigCounts-'));
  try {
    const findings = [
      { rule: 'r1', path: 'a', key: 'k', sev: 'critical', cwe: 'CWE-1', detail: 'd1' },
      { rule: 'r2', path: 'b', key: 'k', sev: 'medium', cwe: 'CWE-2', detail: 'd2' },
      { rule: 'r3', path: 'c', key: 'k', sev: 'low', cwe: 'CWE-3', detail: 'd3' },
      { rule: 'r4', path: 'd', key: 'k', sev: 'unknown', cwe: 'CWE-4', detail: 'd4' },
      { rule: 'r5', path: 'e', key: 'k', sev: 'high', cwe: 'CWE-5', detail: 'd5' }
    ];
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ tool: 'agent-config', summary: { filesScanned: 5 }, findings }));
    const r = _agentConfigCounts(dir, 'a.json');
    assert.equal(r.filesScanned, 5);
    assert.equal(r.crit, 1);
    assert.equal(r.med, 1);
    assert.equal(r.low, 1);
    assert.equal(r.high, 1);
    assert.equal(r.undetermined, 1);
    assert.equal(r.total, 4);
    assert.equal(r.findings.length, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports unparseable files in the summary', () => {
  const dir = mkdtempSync(join(tmpdir(), '_agentConfigCounts-'));
  try {
    const findings = [{ rule: 'r1', path: 'a', key: 'k', sev: 'high', cwe: 'CWE-1', detail: 'd' }];
    writeFileSync(join(dir, 'a.json'), JSON.stringify({
      tool: 'agent-config',
      summary: { filesScanned: 2, unparseable: 1, unparseableFiles: ['bad.json'] },
      findings
    }));
    const r = _agentConfigCounts(dir, 'a.json');
    assert.equal(r.unparseableFiles, 1);
    assert.match(r.unparseableNote, /bad\.json/);
    assert.equal(r.high, 1);
    assert.equal(r.total, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flags partial reads with reasons and notes', () => {
  const dir = mkdtempSync(join(tmpdir(), '_agentConfigCounts-'));
  try {
    const findings = [{ rule: 'r1', path: 'a', key: 'k', sev: 'low', cwe: 'CWE-1', detail: 'd' }];
    writeFileSync(join(dir, 'a.json'), JSON.stringify({
      tool: 'agent-config',
      summary: { filesScanned: 3, partial: true, partialReasons: ['unreadable', 'limit'] },
      findings
    }));
    const r = _agentConfigCounts(dir, 'a.json');
    assert.equal(r.partial, true);
    assert.match(r.partialNote, /unreadable, limit/);
    assert.match(r.partialNote, /findings stand/);
    assert.equal(r.low, 1);
    assert.equal(r.total, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports unmeasured enforcement state with gaps', () => {
  const dir = mkdtempSync(join(tmpdir(), '_agentConfigCounts-'));
  try {
    const findings = [{ rule: 'r1', path: 'a', key: 'k', sev: 'high', cwe: 'CWE-1', detail: 'd' }];
    writeFileSync(join(dir, 'a.json'), JSON.stringify({
      tool: 'agent-config',
      summary: { filesScanned: 1, enforcementState: 'unmeasured', enforcementGaps: 2, enforcementBreaches: 0 },
      findings
    }));
    const r = _agentConfigCounts(dir, 'a.json');
    assert.equal(r.enforcementState, 'unmeasured');
    assert.equal(r.enforcementGaps, 2);
    assert.equal(r.enforcementBreaches, 0);
    assert.match(r.enforcementNote, /unmeasured/);
    assert.match(r.enforcementNote, /2 coverage gap/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports finding enforcement state with breaches', () => {
  const dir = mkdtempSync(join(tmpdir(), '_agentConfigCounts-'));
  try {
    const findings = [{ rule: 'r1', path: 'a', key: 'k', sev: 'critical', cwe: 'CWE-1', detail: 'd' }];
    writeFileSync(join(dir, 'a.json'), JSON.stringify({
      tool: 'agent-config',
      summary: { filesScanned: 1, enforcementState: 'finding', enforcementGaps: 1, enforcementBreaches: 3 },
      findings
    }));
    const r = _agentConfigCounts(dir, 'a.json');
    assert.equal(r.enforcementState, 'finding');
    assert.equal(r.enforcementGaps, 1);
    assert.equal(r.enforcementBreaches, 3);
    assert.match(r.enforcementNote, /3 forbidden effect/);
    assert.match(r.enforcementNote, /1 coverage gap/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
