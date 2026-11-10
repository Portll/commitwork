// web shell detection summary counts (monitor/extractors/tree-contents.mjs _webshellCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _webshellCounts } from '../extractors/tree-contents.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_webshellCounts-'));
  try {
    assert.equal(_webshellCounts(dir, 'nope.json'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a nosrc result when the file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), '_webshellCounts-'));
  try {
    writeFileSync(join(dir, 'empty.json'), '');
    const r = _webshellCounts(dir, 'empty.json');
    assert.equal(r.ran, true);
    assert.equal(r.nosrc, true);
    assert.equal(r.total, 0);
    assert.equal(r.crit, 0);
    assert.equal(r.high, 0);
    assert.equal(r.med, 0);
    assert.equal(r.low, 0);
    assert.equal(r.undetermined, undefined);
    assert.equal(r.filesScanned, undefined);
    assert.equal(r.windowed, undefined);
    assert.equal(r.partial, undefined);
    assert.equal(r.worktrees, undefined);
    assert.equal(r.byRule, undefined);
    assert.equal(r.findings, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an unparseable result when the file is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), '_webshellCounts-'));
  try {
    writeFileSync(join(dir, 'bad.json'), 'not json');
    const r = _webshellCounts(dir, 'bad.json');
    assert.equal(r.ran, true);
    assert.equal(r.unparseable, true);
    assert.equal(r.total, 0);
    assert.equal(r.crit, 0);
    assert.equal(r.high, 0);
    assert.equal(r.med, 0);
    assert.equal(r.low, 0);
    assert.equal(r.undetermined, undefined);
    assert.equal(r.filesScanned, undefined);
    assert.equal(r.windowed, undefined);
    assert.equal(r.partial, undefined);
    assert.equal(r.worktrees, undefined);
    assert.equal(r.byRule, undefined);
    assert.equal(r.findings, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an unparseable result when the tool field is wrong', () => {
  const dir = mkdtempSync(join(tmpdir(), '_webshellCounts-'));
  try {
    writeFileSync(join(dir, 'wrong.json'), JSON.stringify({ tool: 'other', summary: { filesScanned: 1 }, findings: [] }));
    const r = _webshellCounts(dir, 'wrong.json');
    assert.equal(r.ran, true);
    assert.equal(r.unparseable, true);
    assert.equal(r.total, 0);
    assert.equal(r.filesScanned, undefined);
    assert.equal(r.byRule, undefined);
    assert.equal(r.findings, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a nosrc result when filesScanned is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), '_webshellCounts-'));
  try {
    writeFileSync(join(dir, 'zero.json'), JSON.stringify({ tool: 'webshell-detect', summary: { filesScanned: 0 }, findings: [] }));
    const r = _webshellCounts(dir, 'zero.json');
    assert.equal(r.ran, true);
    assert.equal(r.nosrc, true);
    assert.equal(r.total, 0);
    assert.equal(r.filesScanned, undefined);
    assert.equal(r.byRule, undefined);
    assert.equal(r.findings, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a nosrc result when filesScanned is negative', () => {
  const dir = mkdtempSync(join(tmpdir(), '_webshellCounts-'));
  try {
    writeFileSync(join(dir, 'neg.json'), JSON.stringify({ tool: 'webshell-detect', summary: { filesScanned: -1 }, findings: [] }));
    const r = _webshellCounts(dir, 'neg.json');
    assert.equal(r.ran, true);
    assert.equal(r.nosrc, true);
    assert.equal(r.total, 0);
    assert.equal(r.filesScanned, undefined);
    assert.equal(r.byRule, undefined);
    assert.equal(r.findings, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts findings by severity and rule and records windowed and unreadable', () => {
  const dir = mkdtempSync(join(tmpdir(), '_webshellCounts-'));
  try {
    const payload = {
      tool: 'webshell-detect',
      summary: { filesScanned: 10, windowed: 2, unreadable: 1 },
      findings: [
        { rule: 'r1', path: 'a.php', sev: 'crit', cwe: 'CWE-94', detail: 'eval' },
        { rule: 'r1', path: 'b.php', sev: 'high', cwe: 'CWE-94', detail: 'assert' },
        { rule: 'r2', path: 'c.php', sev: 'med', cwe: 'CWE-95', detail: 'system' },
        { rule: 'r3', path: 'd.php', sev: 'low', cwe: 'CWE-96', detail: 'header' },
        { rule: 'r4', path: 'e.php', sev: 'weird', cwe: 'CWE-97', detail: 'x' },
        { rule: 'r5', path: 'f.php', cwe: 'CWE-98', detail: 'y' },
        null,
        42
      ]
    };
    writeFileSync(join(dir, 'full.json'), JSON.stringify(payload));
    const r = _webshellCounts(dir, 'full.json');
    assert.equal(r.ran, true);
    assert.equal(r.filesScanned, 10);
    assert.equal(r.crit, 1);
    assert.equal(r.high, 1);
    assert.equal(r.med, 1);
    assert.equal(r.low, 1);
    assert.equal(r.total, 4);
    assert.equal(r.undetermined, 2);
    assert.equal(r.windowed, 2);
    assert.deepEqual(r.partial, { unreadable: 1, note: '1 file(s) could not be read and none of them was judged, so these counts are a floor.' });
    assert.equal(r.worktrees, undefined);
    assert.deepEqual(r.byRule, {
      r1: { count: 2, sev: 'crit' },
      r2: { count: 1, sev: 'med' },
      r3: { count: 1, sev: 'low' },
      r4: { count: 1, sev: '' },
      r5: { count: 1, sev: '' }
    });
    assert.equal(r.findings.length, 6);
    assert.deepEqual(r.findings[0], { rule: 'r1', file: 'a.php', sev: 'crit', cwe: 'CWE-94', message: 'eval' });
    assert.deepEqual(r.findings[1], { rule: 'r1', file: 'b.php', sev: 'high', cwe: 'CWE-94', message: 'assert' });
    assert.deepEqual(r.findings[2], { rule: 'r2', file: 'c.php', sev: 'med', cwe: 'CWE-95', message: 'system' });
    assert.deepEqual(r.findings[3], { rule: 'r3', file: 'd.php', sev: 'low', cwe: 'CWE-96', message: 'header' });
    assert.deepEqual(r.findings[4], { rule: 'r4', file: 'e.php', sev: '', cwe: 'CWE-97', message: 'x' });
    assert.deepEqual(r.findings[5], { rule: 'r5', file: 'f.php', sev: '', cwe: 'CWE-98', message: 'y' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('omits windowed and partial when their summary values are zero', () => {
  const dir = mkdtempSync(join(tmpdir(), '_webshellCounts-'));
  try {
    const payload = {
      tool: 'webshell-detect',
      summary: { filesScanned: 3, windowed: 0, unreadable: 0 },
      findings: [
        { rule: 'r1', path: 'a.php', sev: 'crit', cwe: 'CWE-94', detail: 'eval' }
      ]
    };
    writeFileSync(join(dir, 'clean.json'), JSON.stringify(payload));
    const r = _webshellCounts(dir, 'clean.json');
    assert.equal(r.ran, true);
    assert.equal(r.filesScanned, 3);
    assert.equal(r.crit, 1);
    assert.equal(r.total, 1);
    assert.equal(r.undetermined, undefined);
    assert.equal(r.windowed, undefined);
    assert.equal(r.partial, undefined);
    assert.equal(r.worktrees, undefined);
    assert.deepEqual(r.byRule, { r1: { count: 1, sev: 'crit' } });
    assert.equal(r.findings.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an unparseable result when findings is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), '_webshellCounts-'));
  try {
    writeFileSync(join(dir, 'nofindings.json'), JSON.stringify({ tool: 'webshell-detect', summary: { filesScanned: 5 }, findings: 'nope' }));
    const r = _webshellCounts(dir, 'nofindings.json');
    assert.equal(r.ran, true);
    assert.equal(r.unparseable, true);
    assert.equal(r.total, 0);
    assert.equal(r.filesScanned, undefined);
    assert.equal(r.byRule, undefined);
    assert.equal(r.findings, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
