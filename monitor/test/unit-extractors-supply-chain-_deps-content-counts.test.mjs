// Counts dependency content findings by severity and rule (monitor/extractors/supply-chain.mjs _depsContentCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _depsContentCounts } from '../extractors/supply-chain.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_depsContentCounts-'));
  try {
    const result = _depsContentCounts(dir, 'missing.json');
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty artifact when the file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), '_depsContentCounts-'));
  try {
    const file = join(dir, 'empty.json');
    writeFileSync(file, '');
    const result = _depsContentCounts(dir, 'empty.json');
    assert.equal(result.ran, true);
    assert.equal(result.total, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), '_depsContentCounts-'));
  try {
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{ invalid json');
    const result = _depsContentCounts(dir, 'bad.json');
    assert.equal(result.ran, true);
    assert.equal(result.unparseable, true);
    assert.equal(result.total, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when the tool field is wrong', () => {
  const dir = mkdtempSync(join(tmpdir(), '_depsContentCounts-'));
  try {
    const file = join(dir, 'wrongtool.json');
    const data = { tool: 'other', summary: { filesScanned: 1 }, findings: [] };
    writeFileSync(file, JSON.stringify(data));
    const result = _depsContentCounts(dir, 'wrongtool.json');
    assert.equal(result.ran, true);
    assert.equal(result.unparseable, true);
    assert.equal(result.total, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns nosrc when filesScanned is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), '_depsContentCounts-'));
  try {
    const file = join(dir, 'nosrc.json');
    const data = { tool: 'deps-content', summary: { filesScanned: 0 }, findings: [] };
    writeFileSync(file, JSON.stringify(data));
    const result = _depsContentCounts(dir, 'nosrc.json');
    assert.equal(result.ran, true);
    assert.equal(result.nosrc, true);
    assert.equal(result.total, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns nosrc with noLockfile when filesScanned is zero and noLockfile is set', () => {
  const dir = mkdtempSync(join(tmpdir(), '_depsContentCounts-'));
  try {
    const file = join(dir, 'nolock.json');
    const data = { tool: 'deps-content', summary: { filesScanned: 0, noLockfile: true }, findings: [] };
    writeFileSync(file, JSON.stringify(data));
    const result = _depsContentCounts(dir, 'nolock.json');
    assert.equal(result.ran, true);
    assert.equal(result.nosrc, true);
    assert.equal(result.noLockfile, true);
    assert.equal(result.total, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns nosrc with couldNotRun when filesScanned is zero and couldNotRun is set', () => {
  const dir = mkdtempSync(join(tmpdir(), '_depsContentCounts-'));
  try {
    const file = join(dir, 'couldnotrun.json');
    const data = { tool: 'deps-content', summary: { filesScanned: 0, couldNotRun: 'parse error' }, findings: [] };
    writeFileSync(file, JSON.stringify(data));
    const result = _depsContentCounts(dir, 'couldnotrun.json');
    assert.equal(result.ran, true);
    assert.equal(result.nosrc, true);
    assert.equal(result.couldNotRun, 'parse error');
    assert.equal(result.total, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts findings by severity and rule', () => {
  const dir = mkdtempSync(join(tmpdir(), '_depsContentCounts-'));
  try {
    const file = join(dir, 'findings.json');
    const data = {
      tool: 'deps-content',
      summary: { filesScanned: 2 },
      findings: [
        { rule: 'R1', sev: 'crit', path: 'node_modules/pkg1/index.js', cwe: 'CWE-1', detail: 'msg1' },
        { rule: 'R1', sev: 'high', path: 'node_modules/pkg2/index.js', cwe: 'CWE-2', detail: 'msg2' },
        { rule: 'R2', sev: 'med', path: 'src/app.js', cwe: 'CWE-3', detail: 'msg3' },
        { rule: 'R3', sev: 'low', path: 'node_modules/pkg3/index.js', cwe: 'CWE-4', detail: 'msg4' },
        { rule: 'R4', sev: 'unknown', path: 'node_modules/pkg4/index.js', cwe: 'CWE-5', detail: 'msg5' }
      ]
    };
    writeFileSync(file, JSON.stringify(data));
    const result = _depsContentCounts(dir, 'findings.json');
    assert.equal(result.ran, true);
    assert.equal(result.filesScanned, 2);
    assert.equal(result.crit, 1);
    assert.equal(result.high, 1);
    assert.equal(result.med, 1);
    assert.equal(result.low, 1);
    assert.equal(result.total, 4);
    assert.equal(result.undetermined, 1);
    assert.equal(result.byRule.R1.count, 2);
    assert.equal(result.byRule.R1.sev, 'crit');
    assert.equal(result.byRule.R2.count, 1);
    assert.equal(result.byRule.R2.sev, 'med');
    assert.equal(result.byRule.R3.count, 1);
    assert.equal(result.byRule.R3.sev, 'low');
    assert.equal(result.byRule.R4.count, 1);
    assert.equal(result.byRule.R4.sev, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('takes the path after node_modules/ as the package field', () => {
  const dir = mkdtempSync(join(tmpdir(), '_depsContentCounts-'));
  try {
    const file = join(dir, 'pkg.json');
    const data = {
      tool: 'deps-content',
      summary: { filesScanned: 1 },
      findings: [
        { rule: 'R1', sev: 'high', path: 'node_modules/lodash/lib/index.js', cwe: 'CWE-1', detail: 'msg' }
      ]
    };
    writeFileSync(file, JSON.stringify(data));
    const result = _depsContentCounts(dir, 'pkg.json');
    assert.equal(result.ran, true);
    assert.equal(result.filesScanned, 1);
    assert.equal(result.high, 1);
    assert.equal(result.total, 1);
    assert.equal(result.findings[0].package, 'lodash/lib/index.js');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses the whole path as the package field when node_modules is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), '_depsContentCounts-'));
  try {
    const file = join(dir, 'src.json');
    const data = {
      tool: 'deps-content',
      summary: { filesScanned: 1 },
      findings: [
        { rule: 'R1', sev: 'med', path: 'src/utils.js', cwe: 'CWE-1', detail: 'msg' }
      ]
    };
    writeFileSync(file, JSON.stringify(data));
    const result = _depsContentCounts(dir, 'src.json');
    assert.equal(result.ran, true);
    assert.equal(result.filesScanned, 1);
    assert.equal(result.med, 1);
    assert.equal(result.total, 1);
    assert.equal(result.findings[0].package, 'src/utils.js');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
