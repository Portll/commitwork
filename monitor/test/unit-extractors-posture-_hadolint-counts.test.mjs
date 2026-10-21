// Counts hadolint findings by severity (monitor/extractors/posture.mjs _hadolintCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _hadolintCounts } from '../extractors/posture.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_hadolintCounts-'));
  try {
    const result = _hadolintCounts(dir, 'missing.json');
    assert.strictEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty artifact when the file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), '_hadolintCounts-'));
  try {
    const f = 'empty.json';
    writeFileSync(join(dir, f), '');
    const result = _hadolintCounts(dir, f);
    assert.deepStrictEqual(result, {
      crit: 0, high: 0, med: 0, low: 0, total: 0,
      ran: true, nosrc: true
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when content is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), '_hadolintCounts-'));
  try {
    const f = 'bad.json';
    writeFileSync(join(dir, f), 'not json');
    const result = _hadolintCounts(dir, f);
    assert.deepStrictEqual(result, {
      crit: 0, high: 0, med: 0, low: 0, total: 0,
      ran: true, unparseable: true
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when JSON is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), '_hadolintCounts-'));
  try {
    const f = 'obj.json';
    writeFileSync(join(dir, f), '{"key":"value"}');
    const result = _hadolintCounts(dir, f);
    assert.deepStrictEqual(result, {
      crit: 0, high: 0, med: 0, low: 0, total: 0,
      ran: true, unparseable: true
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty counts when JSON is an empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), '_hadolintCounts-'));
  try {
    const f = 'clean.json';
    writeFileSync(join(dir, f), '[]');
    const result = _hadolintCounts(dir, f);
    assert.deepStrictEqual(result, {
      crit: 0, high: 0, med: 0, low: 0, total: 0,
      ran: true, findings: []
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts error level as high severity', () => {
  const dir = mkdtempSync(join(tmpdir(), '_hadolintCounts-'));
  try {
    const f = 'err.json';
    const data = [{ code: 'DL3000', level: 'error', file: 'Dockerfile', line: 1, message: 'bad' }];
    writeFileSync(join(dir, f), JSON.stringify(data));
    const result = _hadolintCounts(dir, f);
    assert.strictEqual(result.crit, 0);
    assert.strictEqual(result.high, 1);
    assert.strictEqual(result.med, 0);
    assert.strictEqual(result.low, 0);
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.ran, true);
    assert.deepStrictEqual(result.findings, [
      { rule: 'DL3000', file: 'Dockerfile', line: 1, sev: 'high', message: 'bad' }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts warning level as med severity', () => {
  const dir = mkdtempSync(join(tmpdir(), '_hadolintCounts-'));
  try {
    const f = 'warn.json';
    const data = [{ code: 'DL3001', level: 'warning', file: 'Dockerfile', line: 2, message: 'warn' }];
    writeFileSync(join(dir, f), JSON.stringify(data));
    const result = _hadolintCounts(dir, f);
    assert.strictEqual(result.crit, 0);
    assert.strictEqual(result.high, 0);
    assert.strictEqual(result.med, 1);
    assert.strictEqual(result.low, 0);
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.ran, true);
    assert.deepStrictEqual(result.findings, [
      { rule: 'DL3001', file: 'Dockerfile', line: 2, sev: 'med', message: 'warn' }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts info level as low severity', () => {
  const dir = mkdtempSync(join(tmpdir(), '_hadolintCounts-'));
  try {
    const f = 'info.json';
    const data = [{ code: 'DL3002', level: 'info', file: 'Dockerfile', line: 3, message: 'info' }];
    writeFileSync(join(dir, f), JSON.stringify(data));
    const result = _hadolintCounts(dir, f);
    assert.strictEqual(result.crit, 0);
    assert.strictEqual(result.high, 0);
    assert.strictEqual(result.med, 0);
    assert.strictEqual(result.low, 1);
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.ran, true);
    assert.deepStrictEqual(result.findings, [
      { rule: 'DL3002', file: 'Dockerfile', line: 3, sev: 'low', message: 'info' }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts style level as low severity', () => {
  const dir = mkdtempSync(join(tmpdir(), '_hadolintCounts-'));
  try {
    const f = 'style.json';
    const data = [{ code: 'DL3003', level: 'style', file: 'Dockerfile', line: 4, message: 'style' }];
    writeFileSync(join(dir, f), JSON.stringify(data));
    const result = _hadolintCounts(dir, f);
    assert.strictEqual(result.crit, 0);
    assert.strictEqual(result.high, 0);
    assert.strictEqual(result.med, 0);
    assert.strictEqual(result.low, 1);
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.ran, true);
    assert.deepStrictEqual(result.findings, [
      { rule: 'DL3003', file: 'Dockerfile', line: 4, sev: 'low', message: 'style' }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps unknown level to low severity', () => {
  const dir = mkdtempSync(join(tmpdir(), '_hadolintCounts-'));
  try {
    const f = 'unknown.json';
    const data = [{ code: 'DL9999', level: 'unknown', file: 'Dockerfile', line: 5, message: 'unk' }];
    writeFileSync(join(dir, f), JSON.stringify(data));
    const result = _hadolintCounts(dir, f);
    assert.strictEqual(result.crit, 0);
    assert.strictEqual(result.high, 0);
    assert.strictEqual(result.med, 0);
    assert.strictEqual(result.low, 1);
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.ran, true);
    assert.deepStrictEqual(result.findings, [
      { rule: 'DL9999', file: 'Dockerfile', line: 5, sev: 'low', message: 'unk' }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
