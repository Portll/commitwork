// Counts nuclei findings by severity and builds row details (monitor/extractors/dast.mjs _nucleiCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _nucleiCounts } from '../extractors/dast.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_nucleiCounts-'));
  try {
    const result = _nucleiCounts(dir, 'missing.jsonl');
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns toolfailed when content has no records', () => {
  const dir = mkdtempSync(join(tmpdir(), '_nucleiCounts-'));
  try {
    writeFileSync(join(dir, 'void.jsonl'), 'not json\n{"foo":"bar"}\n');
    const result = _nucleiCounts(dir, 'void.jsonl');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, toolfailed: true, reason: "no nuclei records \u2014 2 non-finding line(s)" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts when file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), '_nucleiCounts-'));
  try {
    writeFileSync(join(dir, 'empty.jsonl'), '');
    const result = _nucleiCounts(dir, 'empty.jsonl');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a high severity finding with template-id', () => {
  const dir = mkdtempSync(join(tmpdir(), '_nucleiCounts-'));
  try {
    const line = JSON.stringify({ 'template-id': 'cve-2024-1', severity: 'high', 'matched-at': 'https://example.com:8443/admin', port: 8443, type: 'http', info: { name: 'XSS' } });
    writeFileSync(join(dir, 'one.jsonl'), line + '\n');
    const result = _nucleiCounts(dir, 'one.jsonl');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, findings: [{ rule: "cve-2024-1", path: "/admin", port: "8443", proto: "http", sev: "high", name: "XSS" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a critical finding using templateID and info.severity', () => {
  const dir = mkdtempSync(join(tmpdir(), '_nucleiCounts-'));
  try {
    const line = JSON.stringify({ templateID: 'cve-2024-2', info: { severity: 'critical', name: 'RCE' }, 'matched-at': 'http://10.0.0.1:9000/api', port: 9000, type: 'http' });
    writeFileSync(join(dir, 'two.jsonl'), line + '\n');
    const result = _nucleiCounts(dir, 'two.jsonl');
    assert.deepEqual(result, { crit: 1, high: 0, med: 0, low: 0, total: 1, ran: true, findings: [{ rule: "cve-2024-2", path: "/api", port: "9000", proto: "http", sev: "crit", name: "RCE" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a medium finding using template field and matched', () => {
  const dir = mkdtempSync(join(tmpdir(), '_nucleiCounts-'));
  try {
    const line = JSON.stringify({ template: 'cve-2024-3', severity: 'medium', matched: 'ftp://host:2121/file.txt', port: 2121, type: 'ftp', info: { name: 'Leak' } });
    writeFileSync(join(dir, 'three.jsonl'), line + '\n');
    const result = _nucleiCounts(dir, 'three.jsonl');
    assert.deepEqual(result, { crit: 0, high: 0, med: 1, low: 0, total: 1, ran: true, findings: [{ rule: "", path: "/file.txt", port: "2121", proto: "ftp", sev: "med", name: "Leak" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a low finding without port or type fields', () => {
  const dir = mkdtempSync(join(tmpdir(), '_nucleiCounts-'));
  try {
    const line = JSON.stringify({ 'template-id': 'cve-2024-4', severity: 'low', 'matched-at': 'https://sub.example.com:443/deep/path', info: { name: 'Info' } });
    writeFileSync(join(dir, 'four.jsonl'), line + '\n');
    const result = _nucleiCounts(dir, 'four.jsonl');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 1, total: 1, ran: true, findings: [{ rule: "cve-2024-4", path: "/deep/path", port: "443", proto: "", sev: "low", name: "Info" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores info severity records but counts them as records', () => {
  const dir = mkdtempSync(join(tmpdir(), '_nucleiCounts-'));
  try {
    const infoLine = JSON.stringify({ 'template-id': 'info-1', severity: 'info', 'matched-at': 'https://example.com/', port: 443, type: 'http', info: { name: 'Info' } });
    const highLine = JSON.stringify({ 'template-id': 'high-1', severity: 'high', 'matched-at': 'https://example.com/x', port: 443, type: 'http', info: { name: 'High' } });
    writeFileSync(join(dir, 'five.jsonl'), infoLine + '\n' + highLine + '\n');
    const result = _nucleiCounts(dir, 'five.jsonl');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, findings: [{ rule: "high-1", path: "/x", port: "443", proto: "http", sev: "high", name: "High" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('truncates name to 120 characters', () => {
  const dir = mkdtempSync(join(tmpdir(), '_nucleiCounts-'));
  try {
    const longName = 'A'.repeat(150);
    const line = JSON.stringify({ 'template-id': 'cve-2024-5', severity: 'high', 'matched-at': 'https://example.com/', port: 443, type: 'http', info: { name: longName } });
    writeFileSync(join(dir, 'six.jsonl'), line + '\n');
    const result = _nucleiCounts(dir, 'six.jsonl');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, findings: [{ rule: "cve-2024-5", path: "/", port: "443", proto: "http", sev: "high", name: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles multiple findings across severities', () => {
  const dir = mkdtempSync(join(tmpdir(), '_nucleiCounts-'));
  try {
    const lines = [
      JSON.stringify({ 'template-id': 't1', severity: 'critical', 'matched-at': 'https://a.com:1/p', port: 1, type: 'http', info: { name: 'C' } }),
      JSON.stringify({ 'template-id': 't2', severity: 'high', 'matched-at': 'https://b.com:2/q', port: 2, type: 'http', info: { name: 'H' } }),
      JSON.stringify({ 'template-id': 't3', severity: 'medium', 'matched-at': 'https://c.com:3/r', port: 3, type: 'http', info: { name: 'M' } }),
      JSON.stringify({ 'template-id': 't4', severity: 'low', 'matched-at': 'https://d.com:4/s', port: 4, type: 'http', info: { name: 'L' } })
    ].join('\n') + '\n';
    writeFileSync(join(dir, 'multi.jsonl'), lines);
    const result = _nucleiCounts(dir, 'multi.jsonl');
    assert.deepEqual(result, { crit: 1, high: 1, med: 1, low: 1, total: 4, ran: true, findings: [{ rule: "t1", path: "/p", port: "1", proto: "http", sev: "crit", name: "C" }, { rule: "t2", path: "/q", port: "2", proto: "http", sev: "high", name: "H" }, { rule: "t3", path: "/r", port: "3", proto: "http", sev: "med", name: "M" }, { rule: "t4", path: "/s", port: "4", proto: "http", sev: "low", name: "L" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
