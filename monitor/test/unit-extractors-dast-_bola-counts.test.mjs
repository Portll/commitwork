// Computes aggregated severity counts and detail rows from a bola JSON file (monitor/extractors/dast.mjs _bolaCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _bolaCounts } from '../extractors/dast.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bolaCounts-'));
  try {
    const result = _bolaCounts(dir, 'missing.json');
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty artifact when the file is empty or whitespace only', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bolaCounts-'));
  const file = 'empty.json';
  writeFileSync(join(dir, file), '   \n\t');
  try {
    const result = _bolaCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable result when JSON is malformed', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bolaCounts-'));
  const file = 'bad.json';
  writeFileSync(join(dir, file), '{ not: "json" ');
  try {
    const result = _bolaCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable result when parsed JSON is not an object', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bolaCounts-'));
  const file = 'array.json';
  writeFileSync(join(dir, file), '[]');
  try {
    const result = _bolaCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns nosrc result when j.ran is false', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bolaCounts-'));
  const file = 'nosrc.json';
  writeFileSync(join(dir, file), JSON.stringify({ ran: false }));
  try {
    const result = _bolaCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts findings with various severities and maps them correctly', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bolaCounts-'));
  const file = 'findings.json';
  const payload = {
    ran: true,
    findings: [
      { type: 'typeA', path: '/a', severity: 'critical', detail: 'detailA' },
      { type: 'typeB', path: '/b', severity: 'HIGH', detail: 'detailB', direction: 'in' },
      { type: 'typeC', path: '/c', severity: 'med', detail: 'detailC' },
      { type: 'typeD', path: '/d', severity: 'unknown', detail: 'detailD' }
    ]
  };
  writeFileSync(join(dir, file), JSON.stringify(payload));
  try {
    const result = _bolaCounts(dir, file);
    assert.deepEqual(result, { crit: 1, high: 2, med: 1, low: 0, total: 4, ran: true, findings: [{ probe: "typeA", path: "/a", sev: "crit", message: "detailA" }, { probe: "typeB", path: "/b", sev: "high", message: "detailB (in)" }, { probe: "typeC", path: "/c", sev: "med", message: "detailC" }, { probe: "typeD", path: "/d", sev: "high", message: "detailD" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('defaults severity to high when severity is missing or empty', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bolaCounts-'));
  const file = 'defaultSev.json';
  const payload = {
    ran: true,
    findings: [
      { type: 't1', path: '/p1', detail: 'd1' },
      { type: 't2', path: '/p2', severity: '', detail: 'd2' }
    ]
  };
  writeFileSync(join(dir, file), JSON.stringify(payload));
  try {
    const result = _bolaCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 2, med: 0, low: 0, total: 2, ran: true, findings: [{ probe: "t1", path: "/p1", sev: "high", message: "d1" }, { probe: "t2", path: "/p2", sev: "high", message: "d2" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes direction in message when present', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bolaCounts-'));
  const file = 'direction.json';
  const payload = {
    ran: true,
    findings: [
      { type: 't', path: '/p', severity: 'low', detail: 'msg', direction: 'out' }
    ]
  };
  writeFileSync(join(dir, file), JSON.stringify(payload));
  try {
    const result = _bolaCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 1, total: 1, ran: true, findings: [{ probe: "t", path: "/p", sev: "low", message: "msg (out)" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
