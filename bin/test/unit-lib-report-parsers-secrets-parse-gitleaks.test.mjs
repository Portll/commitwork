// Parses a gitleaks JSON report into a severity summary, verifying the scan ran when no findings exist (bin/lib/report-parsers/secrets.mjs parseGitleaks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGitleaks } from '../lib/report-parsers/secrets.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns ok false and no gitleaks data summary when the report is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseGitleaks-'));
  try {
    const p = join(dir, 'gitleaks.json');
    writeFileSync(p, JSON.stringify({ foo: 1 }));
    assert.deepEqual(parseGitleaks(p), { ok: false, summary: 'no gitleaks data' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false and noscan severity when the report is an empty array and the log file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseGitleaks-'));
  try {
    const p = join(dir, 'gitleaks.json');
    writeFileSync(p, '[]');
    assert.deepEqual(parseGitleaks(p), {
      ok: false,
      sev: 'noscan',
      total: 0,
      summary: 'no findings and no "scanned ~N bytes" receipt in gitleaks.log \u2014 the scan did not finish'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false and noscan severity when the report is an empty array and the log has no scanned bytes line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseGitleaks-'));
  try {
    const p = join(dir, 'gitleaks.json');
    writeFileSync(p, '[]');
    writeFileSync(join(dir, 'gitleaks.log'), 'some other output\n');
    assert.deepEqual(parseGitleaks(p), {
      ok: false,
      sev: 'noscan',
      total: 0,
      summary: 'no findings and no "scanned ~N bytes" receipt in gitleaks.log \u2014 the scan did not finish'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false and noscan severity when the report is an empty array and the log reports zero bytes scanned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseGitleaks-'));
  try {
    const p = join(dir, 'gitleaks.json');
    writeFileSync(p, '[]');
    writeFileSync(join(dir, 'gitleaks.log'), 'INF scanned ~0 bytes\n');
    assert.deepEqual(parseGitleaks(p), {
      ok: false,
      sev: 'noscan',
      total: 0,
      summary: 'gitleaks finished having scanned 0 bytes \u2014 an empty scan is not a clean repo'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true and ok severity with a megabyte summary when the report is an empty array and the log reports bytes scanned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseGitleaks-'));
  try {
    const p = join(dir, 'gitleaks.json');
    writeFileSync(p, '[]');
    writeFileSync(join(dir, 'gitleaks.log'), 'INF scanned ~7,301,440 bytes\n');
    assert.deepEqual(parseGitleaks(p), {
      ok: true,
      total: 0,
      sev: 'ok',
      summary: '0 (6.96 MB scanned)'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true and high severity with a singular summary when the report has one finding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseGitleaks-'));
  try {
    const p = join(dir, 'gitleaks.json');
    writeFileSync(p, JSON.stringify([{ RuleID: 'aws-key' }]));
    assert.deepEqual(parseGitleaks(p), {
      ok: true,
      total: 1,
      sev: 'high',
      summary: '1 secret finding'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true and high severity with a plural summary when the report has multiple findings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseGitleaks-'));
  try {
    const p = join(dir, 'gitleaks.json');
    writeFileSync(p, JSON.stringify([{ RuleID: 'aws-key' }, { RuleID: 'github-token' }]));
    assert.deepEqual(parseGitleaks(p), {
      ok: true,
      total: 2,
      sev: 'high',
      summary: '2 secret findings'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
