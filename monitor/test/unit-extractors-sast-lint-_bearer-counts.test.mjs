// Computes bearer JSON severity counts and detail rows (monitor/extractors/sast-lint.mjs _bearerCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _bearerCounts } from '../extractors/sast-lint.mjs';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('returns null when the JSON file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bearerCounts-'));
  try {
    const result = _bearerCounts(dir, 'missing.json');
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty artifact when the JSON file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bearerCounts-'));
  try {
    const file = 'empty.json';
    writeFileSync(join(dir, file), '');
    const result = _bearerCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable object when JSON is malformed', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bearerCounts-'));
  try {
    const file = 'bad.json';
    writeFileSync(join(dir, file), '{ not: json ');
    const result = _bearerCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable object when parsed JSON is not an object', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bearerCounts-'));
  try {
    const file = 'array.json';
    writeFileSync(join(dir, file), '[]');
    const result = _bearerCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns toolfailed when exit sidecar contains invalid exit code', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bearerCounts-'));
  try {
    const file = 'data.json';
    writeFileSync(join(dir, file), '{}');
    writeFileSync(join(dir, `${file}.exit`), '2');
    const result = _bearerCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, toolfailed: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when JSON has keys but none are known severity buckets', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bearerCounts-'));
  try {
    const file = 'unknown.json';
    writeFileSync(join(dir, file), JSON.stringify({ foo: [] }));
    const result = _bearerCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts critical, high, medium, low findings and builds detail rows', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bearerCounts-'));
  try {
    const file = 'findings.json';
    const payload = {
      critical: [{ id: 'C1', filename: 'a.js', line_number: 10, title: 'Critical issue' }],
      high: [{ id: 'H1', filename: 'b.js', line_number: 20, title: 'High issue' }],
      medium: [{ id: 'M1', filename: 'c.js', line_number: 30, title: 'Medium issue' }],
      low: [{ id: 'L1', filename: 'd.js', line_number: 40, title: 'Low issue' }],
      warning: [{ id: 'W1', filename: 'e.js', line_number: 50, title: 'Just a warning' }]
    };
    writeFileSync(join(dir, file), JSON.stringify(payload));
    const result = _bearerCounts(dir, file);
    assert.deepEqual(result, { crit: 1, high: 1, med: 1, low: 1, total: 4, ran: true, findings: [{ rule: "C1", file: "a.js", line: 10, sev: "crit", message: "Critical issue", corroboratedBy: "" }, { rule: "H1", file: "b.js", line: 20, sev: "high", message: "High issue", corroboratedBy: "" }, { rule: "M1", file: "c.js", line: 30, sev: "med", message: "Medium issue", corroboratedBy: "" }, { rule: "L1", file: "d.js", line: 40, sev: "low", message: "Low issue", corroboratedBy: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles missing .exit sidecar as vintage artifact (exit defaults to 0)', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bearerCounts-'));
  try {
    const file = 'vintage.json';
    writeFileSync(join(dir, file), JSON.stringify({ warning: [] }));
    const result = _bearerCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('treats empty object as clean scan (no findings, zero counts)', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bearerCounts-'));
  try {
    const file = 'clean.json';
    writeFileSync(join(dir, file), '{}');
    const result = _bearerCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
