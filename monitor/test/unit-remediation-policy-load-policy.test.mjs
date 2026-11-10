// Load a remediation policy file, validate it, and gate agentic modes on a fresh witness (monitor/remediation-policy.mjs loadPolicy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPolicy } from '../remediation-policy.mjs';

test('returns safe defaults when the policy file is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPolicy-'));
  try {
    const p = loadPolicy(join(dir, 'nope.json'));
    assert.equal(p.source, 'default');
    assert.equal(p.mode, 'report');
    assert.equal(p.verification, 'single');
    assert.equal(p.learning, 'off');
    assert.equal(p.cadence, 'quarterly');
    assert.equal(p.remediationBudgetPctOfCompute, 0);
    assert.equal(p.m3.autoMerge, false);
    assert.equal(p.m3.owner, null);
    assert.deepEqual(p.m3.scope, { minSeverity: 'high', pathAllowlist: [], ruleAllowlist: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns safe defaults when the path argument is empty', () => {
  const p = loadPolicy('');
  assert.equal(p.source, 'default');
  assert.equal(p.mode, 'report');
});

test('throws when the policy file is corrupt JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPolicy-'));
  try {
    const f = join(dir, 'bad.json');
    writeFileSync(f, '{ not json');
    assert.throws(() => loadPolicy(f), /corrupt \(unparseable JSON\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the policy file is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPolicy-'));
  try {
    const f = join(dir, 'inv.json');
    writeFileSync(f, JSON.stringify({ mode: 'bogus' }));
    assert.throws(() => loadPolicy(f), /invalid/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the merged policy from a valid file with agentic gate off', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPolicy-'));
  try {
    const f = join(dir, 'ok.json');
    writeFileSync(f, JSON.stringify({ mode: 'report', verification: 'double-arbitrate' }));
    const p = loadPolicy(f, { agenticGate: false });
    assert.equal(p.source, 'file');
    assert.equal(p.mode, 'report');
    assert.equal(p.verification, 'double-arbitrate');
    assert.equal(p.learning, 'off');
    assert.equal(p.cadence, 'quarterly');
    assert.equal(p.remediationBudgetPctOfCompute, 0);
    assert.equal(p.m3.autoMerge, false);
    assert.equal(p.m3.owner, null);
    assert.deepEqual(p.m3.scope, { minSeverity: 'high', pathAllowlist: [], ruleAllowlist: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deep-merges a partial m3 scope over the defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPolicy-'));
  try {
    const f = join(dir, 'm3.json');
    writeFileSync(f, JSON.stringify({ m3: { scope: { minSeverity: 'medium' } } }));
    const p = loadPolicy(f, { agenticGate: false });
    assert.equal(p.m3.autoMerge, false);
    assert.equal(p.m3.owner, null);
    assert.equal(p.m3.scope.minSeverity, 'medium');
    assert.deepEqual(p.m3.scope.pathAllowlist, []);
    assert.deepEqual(p.m3.scope.ruleAllowlist, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when an agentic mode is refused because the witness is not fresh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPolicy-'));
  try {
    const f = join(dir, 'ag.json');
    writeFileSync(f, JSON.stringify({ mode: 'full-agentic' }));
    assert.throws(() => loadPolicy(f), /refused for this run/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the policy file is unreadable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPolicy-'));
  try {
    const f = join(dir, 'secret.json');
    writeFileSync(f, 'x', { mode: 0o000 });
    assert.throws(() => loadPolicy(f), /unreadable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
