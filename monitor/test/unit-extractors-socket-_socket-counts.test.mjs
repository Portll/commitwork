// computes scan presence, parsing and alert counting (monitor/extractors/socket.mjs _socketCounts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _socketCounts } from '../extractors/socket.mjs';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_socketCounts-'));
  try {
    const result = _socketCounts(dir, 'missing.json');
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for a zero\u2011byte husk (empty file)', () => {
  const dir = mkdtempSync(join(tmpdir(), '_socketCounts-'));
  const file = 'empty.json';
  writeFileSync(join(dir, file), '');
  try {
    const result = _socketCounts(dir, file);
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable object when JSON is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), '_socketCounts-'));
  const file = 'bad.json';
  writeFileSync(join(dir, file), '{ not: valid ');
  try {
    const result = _socketCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable object when parsed JSON is not an object', () => {
  const dir = mkdtempSync(join(tmpdir(), '_socketCounts-'));
  const file = 'number.json';
  writeFileSync(join(dir, file), '123');
  try {
    const result = _socketCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when scan is not completed (ok:false)', () => {
  const dir = mkdtempSync(join(tmpdir(), '_socketCounts-'));
  const file = 'refused.json';
  writeFileSync(join(dir, file), JSON.stringify({ ok: false }));
  try {
    const result = _socketCounts(dir, file);
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('processes legacy array alerts and returns tally object', () => {
  const dir = mkdtempSync(join(tmpdir(), '_socketCounts-'));
  const file = 'legacy.json';
  const payload = { ok: true, alerts: [{ type: 'criticalCVE' }, { type: 'gptMalware' }] };
  writeFileSync(join(dir, file), JSON.stringify(payload));
  try {
    const result = _socketCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 2, ran: true, undetermined: 2, byKind: { vulnerability: { crit: 0, high: 0, med: 0, low: 0, undetermined: 1 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 1 } }, findings: [{ rule: "criticalCVE", package: "", version: "", ecosystem: "", sev: "", message: "", claimKind: "vulnerability", sevReason: "pending-dedup-against-cve-lanes" }, { rule: "gptMalware", package: "", version: "", ecosystem: "", sev: "", message: "", claimKind: "integrity", sevReason: "single-source-llm-unverified" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('processes new\u2011shape alerts with one entry and returns correct total', () => {
  const dir = mkdtempSync(join(tmpdir(), '_socketCounts-'));
  const file = 'new.json';
  const payload = {
    ok: true,
    data: {
      alerts: {
        npm: {
          lodash: {
            '4.17.21': { type: 'criticalCVE', severity: 'high', description: 'test' }
          }
        }
      }
    }
  };
  writeFileSync(join(dir, file), JSON.stringify(payload));
  try {
    const result = _socketCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, undetermined: 0, byKind: { vulnerability: { crit: 0, high: 1, med: 0, low: 0, undetermined: 0 } }, findings: [{ rule: "criticalCVE", package: "lodash", version: "4.17.21", ecosystem: "npm", sev: "high", message: "test", claimKind: "vulnerability", sevReason: "pending-dedup-against-cve-lanes" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns object with zero total when alerts object is empty but scan completed', () => {
  const dir = mkdtempSync(join(tmpdir(), '_socketCounts-'));
  const file = 'emptyalerts.json';
  const payload = { ok: true, data: { alerts: {} } };
  writeFileSync(join(dir, file), JSON.stringify(payload));
  try {
    const result = _socketCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, undetermined: 0, byKind: {}, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when file exists but contains only whitespace', () => {
  const dir = mkdtempSync(join(tmpdir(), '_socketCounts-'));
  const file = 'ws.json';
  writeFileSync(join(dir, file), '   \n\t  ');
  try {
    const result = _socketCounts(dir, file);
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
