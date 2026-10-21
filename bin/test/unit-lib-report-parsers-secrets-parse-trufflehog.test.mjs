// Parses trufflehog JSONL output and its log receipt to classify scan status (bin/lib/report-parsers/secrets.mjs parseTrufflehog).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrufflehog } from '../lib/report-parsers/secrets.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns ok with verified and unverified counts when findings exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseTrufflehog-'));
  try {
    const path = join(dir, 'trufflehog.jsonl');
    writeFileSync(path, [
      JSON.stringify({ DetectorName: 'AWS', Verified: true }),
      JSON.stringify({ DetectorName: 'GitHub', Verified: false }),
      JSON.stringify({ DetectorName: 'Slack', Verified: true })
    ].join('\n'));
    const r = parseTrufflehog(path);
    assert.deepEqual(r, { ok: true, total: 3, verified: 2, sev: 'high', summary: '2 verified / 1 unverified' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok with med severity when findings exist but none are verified', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseTrufflehog-'));
  try {
    const path = join(dir, 'trufflehog.jsonl');
    writeFileSync(path, [
      JSON.stringify({ DetectorName: 'AWS', Verified: false }),
      JSON.stringify({ DetectorName: 'GitHub', Verified: false })
    ].join('\n'));
    const r = parseTrufflehog(path);
    assert.deepEqual(r, { ok: true, total: 2, verified: 0, sev: 'med', summary: '0 verified / 2 unverified' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok with zero secrets when file is empty and receipt shows chunks scanned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseTrufflehog-'));
  try {
    const path = join(dir, 'trufflehog.jsonl');
    writeFileSync(path, '');
    const logPath = join(dir, 'trufflehog.log');
    writeFileSync(logPath, JSON.stringify({ msg: 'finished scanning', chunks: 5000, bytes: 102400, trufflehog_version: '3.95.9' }) + '\n');
    const r = parseTrufflehog(path);
    assert.deepEqual(r, {
      ok: true,
      total: 0,
      verified: 0,
      sev: 'ok',
      receipt: { chunks: 5000, bytes: 102400 },
      summary: '0 secrets \u2014 5,000 chunk(s) / 102,400 byte(s) scanned'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when file is empty and no receipt exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseTrufflehog-'));
  try {
    const path = join(dir, 'trufflehog.jsonl');
    writeFileSync(path, '');
    const r = parseTrufflehog(path);
    assert.deepEqual(r, {
      ok: false,
      sev: 'noscan',
      summary: 'no findings and no completion receipt in trufflehog.log \u2014 the scan did not finish'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when file is empty and receipt has zero chunks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseTrufflehog-'));
  try {
    const path = join(dir, 'trufflehog.jsonl');
    writeFileSync(path, '');
    const logPath = join(dir, 'trufflehog.log');
    writeFileSync(logPath, JSON.stringify({ msg: 'finished scanning', chunks: 0, bytes: 0, trufflehog_version: '3.95.9' }) + '\n');
    const r = parseTrufflehog(path);
    assert.deepEqual(r, {
      ok: false,
      sev: 'noscan',
      summary: 'scan finished having examined NOTHING (0 chunks) \u2014 an empty scan is not a clean repo [3.95.9]'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when file has non-JSON lines and no findings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseTrufflehog-'));
  try {
    const path = join(dir, 'trufflehog.jsonl');
    writeFileSync(path, 'some log line\nanother log line\n');
    const r = parseTrufflehog(path);
    assert.deepEqual(r, {
      ok: false,
      sev: 'noscan',
      summary: 'output not parseable \u2014 2 line(s), tool likely failed'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when file has valid JSON but no finding records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseTrufflehog-'));
  try {
    const path = join(dir, 'trufflehog.jsonl');
    writeFileSync(path, JSON.stringify({ error: 'permission denied' }) + '\n');
    const r = parseTrufflehog(path);
    assert.deepEqual(r, {
      ok: false,
      sev: 'noscan',
      summary: 'no trufflehog records \u2014 1 line(s) of something else'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok with zero secrets when file is empty and receipt has no version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseTrufflehog-'));
  try {
    const path = join(dir, 'trufflehog.jsonl');
    writeFileSync(path, '');
    const logPath = join(dir, 'trufflehog.log');
    writeFileSync(logPath, JSON.stringify({ msg: 'finished scanning', chunks: 100, bytes: 2048 }) + '\n');
    const r = parseTrufflehog(path);
    assert.deepEqual(r, {
      ok: true,
      total: 0,
      verified: 0,
      sev: 'ok',
      receipt: { chunks: 100, bytes: 2048 },
      summary: '0 secrets \u2014 100 chunk(s) / 2,048 byte(s) scanned'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
